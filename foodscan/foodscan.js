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
      const [T, C] = await Promise.all([fetch(BASE + 'text-emb.json').then((r) => r.json()), fetch(BASE + 'calib.json').then((r) => r.json())]);
      S.T = T; S.C = C;
      const tf = await import(BASE + 'vendor/transformers.web.min.js');
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
      S.device = dev; return S;
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
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]; const cr = await raw.crop([c.x, c.y, c.x + c.w - 1, c.y + c.h - 1]);
      const inp = await S.proc(cr); const { image_embeds } = await S.model(inp); embs.push(Array.from(image_embeds.data));
      if (opt.onStep) opt.onStep(i + 1, cs.length);
    }
    const res = FoodScanCore.analyze(embs, S.T, S.C, { plateCm: opt.plateCm || 26 });
    res.ms = Math.round(performance.now() - t0); res.device = S.device; res.canvas = canvas; res.crops = cs;
    return res;
  }
  window.FoodScan = { load, scan, isCached, modelSize, state: S, base: BASE };
})();
