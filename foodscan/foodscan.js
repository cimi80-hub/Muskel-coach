/* Dr. Muskel Coach – FoodScan (on-device). Lädt Modell & Bibliothek vom eigenen Server (GitHub Pages),
 * speichert sie im Gerät (Cache Storage) und rechnet komplett lokal: WebGPU wenn verfügbar, sonst WebAssembly. */
(function () {
  const BASE = new URL('./', document.currentScript ? document.currentScript.src : location.href).href; // …/foodscan/
  const MODEL = 'Xenova/clip-vit-base-patch32';
  const MODEL_FILE = BASE + 'models/' + MODEL + '/onnx/vision_model_quantized.onnx';
  const S = { tf: null, proc: null, model: null, T: null, C: null, device: null, loading: null };

  async function isCached() { try { const c = await caches.open('transformers-cache'); return !!(await c.match(MODEL_FILE)); } catch (e) { return false; } }
  async function modelSize() { try { const r = await fetch(MODEL_FILE, { method: 'HEAD' }); return +r.headers.get('content-length') || 0; } catch (e) { return 0; } }

  async function load(onProgress) {
    if (S.model) return S;
    if (S.loading) return S.loading;
    S.loading = (async () => {
      const [T, C, M2] = await Promise.all([fetch(BASE + 'text-emb.json').then((r) => r.json()), fetch(BASE + 'calib.json').then((r) => r.json()), fetch(BASE + 'model2.json').then((r) => r.ok ? r.json() : null).catch(() => null)]);
      S.T = T; S.C = C; S.M2 = M2;
      const tf = await import(BASE + 'vendor/transformers.min.js');
      tf.env.allowRemoteModels = false; tf.env.allowLocalModels = true; tf.env.localModelPath = BASE + 'models/'; tf.env.useBrowserCache = true;
      tf.env.backends.onnx.wasm.wasmPaths = BASE + 'vendor/';
      if (!self.crossOriginIsolated) tf.env.backends.onnx.wasm.numThreads = 1;
      S.tf = tf;
      const prog = (p) => { if (onProgress && p && p.status === 'progress' && /\.onnx$/.test(p.file || '')) onProgress(Math.round(p.progress || 0)); };
      S.proc = await tf.AutoProcessor.from_pretrained(MODEL);
      let dev = 'wasm';
      if (navigator.gpu) { try { const a = await navigator.gpu.requestAdapter(); if (a) dev = 'webgpu'; } catch (e) {} }
      try { S.model = await tf.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', device: dev, progress_callback: prog }); }
      catch (e) { if (dev === 'wasm') throw e; dev = 'wasm'; S.model = await tf.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: prog }); }
      S.device = dev;
      if (M2 && M2.needDepth) { S.depth = await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: M2.depthDtype || 'q8', device: dev === 'webgpu' ? 'webgpu' : 'wasm', progress_callback: prog }).catch(() => null); }
      return S;
    })();
    try { return await S.loading; } catch (e) { S.loading = null; throw e; }
  }

  // Bild verkleinern (max. 896 px) → RawImage
  async function toRaw(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const sc = Math.min(1, 896 / Math.max(bmp.width, bmp.height)); const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return { raw: S.tf.RawImage.fromCanvas(cv), canvas: cv };
  }

  async function scan(file, opt = {}) {
    await load(opt.onProgress);
    const t0 = performance.now();
    const { raw, canvas } = await toRaw(file);
    const cs = FoodScanCore.crops(raw.width, raw.height); const embs = [];
    const crs = []; for (const c of cs) crs.push(await raw.crop([c.x, c.y, c.x + c.w - 1, c.y + c.h - 1]));
    if (opt.onStep) opt.onStep(1, 2);
    const { image_embeds } = await S.model(await S.proc(crs)); const d = image_embeds.dims[1];
    for (let i = 0; i < cs.length; i++) embs.push(Array.from(image_embeds.data.subarray(i * d, (i + 1) * d)));
    if (opt.onStep) opt.onStep(2, 2);
    const res = FoodScanCore.analyze(embs, S.T, S.C, { plateCm: opt.plateCm || 26 });
    let dep = null;
    if (S.depth) { const c0 = cs[0]; const sq = await raw.crop([c0.x, c0.y, c0.x + c0.w - 1, c0.y + c0.h - 1]); const out = await S.depth(sq);
      const P = out.predicted_depth, [h, w] = P.dims.slice(-2), a = P.data, G = 8, grid = new Array(G * G).fill(0), cnt = new Array(G * G).fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = Math.min(G - 1, Math.floor(y / h * G)) * G + Math.min(G - 1, Math.floor(x / w * G)); grid[k] += a[y * w + x]; cnt[k]++; }
      const srt = Array.from(a).sort((p, q) => p - q), q = (f) => srt[Math.floor(f * (srt.length - 1))];
      dep = { grid: grid.map((v, i) => Math.round(v / cnt[i] * 1000) / 1000), p: [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98].map((f) => Math.round(q(f) * 1000) / 1000) }; }
    if (S.M2) {
      res.est = FoodScanCore.estimate(embs, S.T, S.M2, dep, opt.plateCm || 26);
      // Persönliches Gedächtnis: sehr ähnliches, früher bestätigtes Gericht → dessen bestätigte Werte bevorzugen
      const mem = memMatch(embs[0]); if (mem) { res.memory = mem; }
      // unsichere Kleinst-Posten entfernen (kleine Fläche UND im Gesamtbild kaum sichtbar)
      if (res.items.length > 1) res.items = res.items.filter((it) => !((it.frac < 0.07 && it.conf < 0.05) || (it.frac < 0.15 && it.conf < 0.005)));
      // Einzel-Lebensmittel so skalieren, dass ihre Kalorien zur Gesamtschätzung passen
      const ps = personalStats(); if (ps && !mem && ps.n >= 5) { const f = Math.exp(Math.log(ps.factor) * ps.n / (ps.n + 10)); res.est.kcal = Math.round(res.est.kcal * f); res.est.personal = Math.round(f * 100) / 100; }
      const target = mem ? mem.kcal : res.est.kcal, cur = res.items.reduce((s, it) => s + (it.kcal || 0), 0);
      if (cur > 0 && target > 0) { const f = target / cur; res.items.forEach((it) => { it.grams = Math.max(3, Math.round(it.grams * f)); it.kcal = it.db && it.db.kcal != null ? Math.round(it.db.kcal * it.grams / 100) : null; }); }
      res.embWhole = embs[0];
    }
    res.ms = Math.round(performance.now() - t0); res.device = S.device; res.canvas = canvas; res.crops = cs;
    return res;
  }
  // ----- Persönliche Korrekturen (nur lokal gespeichert) -----
  const MEMK = 'dmc_fs_mem';
  const memAll = () => { try { return JSON.parse(localStorage.getItem(MEMK) || '[]'); } catch (e) { return []; } };
  const n8 = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => Math.round(x / s * 127 / 0.5)); };
  function memMatch(emb) { const all = memAll(); if (!all.length) return null; const q = n8(emb); let best = null, bs = 0;
    for (const m of all) { let s = 0; for (let j = 0; j < q.length; j++) s += q[j] * m.e[j]; s *= (0.5 / 127) ** 2; if (s > bs) { bs = s; best = m; } }
    return bs >= 0.93 ? { kcal: best.k, items: best.items, sim: Math.round(bs * 100) / 100, date: best.d } : null; }
  function remember(emb, items, predKcal) { const k = items.reduce((s, it) => s + (it.kcal || 0), 0); if (!k) return;
    const all = memAll(); all.push({ e: n8(emb), k: Math.round(k), pk: Math.round(predKcal || 0), items: items.map((it) => [it.k, it.grams]), d: new Date().toISOString().slice(0, 10) });
    try { localStorage.setItem(MEMK, JSON.stringify(all.slice(-60))); } catch (e) {} }
  function personalStats() { const a = memAll().filter((m) => m.pk > 0); if (a.length < 3) return null; const r = a.map((m) => Math.log(m.k / m.pk)); const mean = r.reduce((x, y) => x + y, 0) / r.length;
    return { n: a.length, factor: Math.round(Math.exp(mean) * 100) / 100 }; }
  window.FoodScan = { load, scan, isCached, modelSize, state: S, base: BASE, remember, personalStats, memCount: () => memAll().length };
})();
