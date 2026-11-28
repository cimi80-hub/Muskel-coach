// FoodScan-Build & Messung (läuft in GitHub Actions mit Internet)
// 1) CLIP ViT-B/32 (MIT) laden → Text-Embeddings der Lebensmittelklassen vorberechnen (Handy braucht nur das Bildmodell)
// 2) Nutrition5k (CC BY 4.0) Overhead-Fotos + gewogene Massen laden
// 3) Gleiche Pipeline wie im Handy laufen lassen, Masse pro Kategorie kalibrieren (Trainingsteil),
//    Genauigkeit auf getrenntem Testteil messen. Ergebnisse → foodscan/text-emb.json, foodscan/calib.json, foodscan/eval-report.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { env, AutoProcessor, AutoTokenizer, CLIPVisionModelWithProjection, CLIPTextModelWithProjection, RawImage } from '@huggingface/transformers';
const require = createRequire(import.meta.url);
const Core = require(path.resolve('foodscan/foodscan-core.js'));

const MODEL = 'Xenova/clip-vit-base-patch32';
const N_DISH = +(process.env.N_DISH || 400);
env.cacheDir = path.resolve('foodscan/models');
env.allowLocalModels = false;

const labels = JSON.parse(fs.readFileSync('tools/foodscan/labels.resolved.json', 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- 1. Text-Embeddings ----------
log('Lade Text-Modell …');
const tok = await AutoTokenizer.from_pretrained(MODEL);
const tmodel = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32', cache_dir: '/tmp/hfcache' });
const T_FOOD = ['a photo of {}, a type of food.', 'a close-up photo of {} on a plate.', 'a top-down photo of {}.'];
const T_NON = ['a photo of {}.', 'a top-down photo of {}.'];
const dim = 512; const all = [];
for (const l of labels) {
  const tpl = l.cat === 'nonfood' ? T_NON : T_FOOD;
  const inp = tok(tpl.map((t) => t.replace('{}', l.en)), { padding: true, truncation: true });
  const { text_embeds } = await tmodel(inp);
  const v = new Float32Array(dim);
  for (let r = 0; r < tpl.length; r++) { let s = 0; for (let j = 0; j < dim; j++) s += text_embeds.data[r * dim + j] ** 2; s = Math.sqrt(s); for (let j = 0; j < dim; j++) v[j] += text_embeds.data[r * dim + j] / s; }
  let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); for (let j = 0; j < dim; j++) v[j] /= s;
  all.push(v);
}
let mx = 0; for (const v of all) for (const x of v) mx = Math.max(mx, Math.abs(x));
const q = Buffer.alloc(labels.length * dim); all.forEach((v, i) => v.forEach((x, j) => { q.writeInt8(Math.max(-127, Math.min(127, Math.round(x / mx * 127))), i * dim + j); }));
const T = { model: MODEL, dim, labels: labels.map((l) => ({ k: l.k, de: l.de, en: l.en, cat: l.cat, db: l.db })), q: q.toString('base64') };
fs.writeFileSync('foodscan/text-emb.json', JSON.stringify(T));
log('Text-Embeddings:', labels.length, 'Klassen,', Math.round(fs.statSync('foodscan/text-emb.json').size / 1024), 'KB');

// ---------- 2. Bildmodell (genau die Datei, die das Handy lädt) ----------
const proc = await AutoProcessor.from_pretrained(MODEL);
const vmodel = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' });
async function embedImage(img) {
  const cs = Core.crops(img.width, img.height); const out = [];
  for (const c of cs) { const cr = await img.crop([c.x, c.y, c.x + c.w - 1, c.y + c.h - 1]); const inp = await proc(cr); const { image_embeds } = await vmodel(inp); out.push(Array.from(image_embeds.data)); }
  return out;
}

// ---------- 3. Nutrition5k ----------
const BASE = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset';
log('Lade Nutrition5k-Metadaten …');
const meta = await (await fetch(`${BASE}/metadata/dish_metadata_cafe1.csv`)).text();
const dishes = [];
for (const line of meta.split('\n')) {
  const f = line.split(','); if (f.length < 6 || !/^dish_/.test(f[0])) continue;
  const ings = []; for (let i = 6; i + 6 < f.length; i += 7) ings.push({ name: f[i + 1], g: +f[i + 2], kcal: +f[i + 3] });
  dishes.push({ id: f[0], kcal: +f[1], mass: +f[2], fat: +f[3], carb: +f[4], prot: +f[5], ings });
}
log('Gerichte in Metadaten:', dishes.length);
// feste Zufallsauswahl (reproduzierbar), nur sinnvolle Massen
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pool = dishes.filter((d) => d.mass >= 20 && d.mass <= 1500 && d.kcal > 0).sort(() => rnd() - 0.5);
const used = []; const t0 = Date.now(); let tScan = 0;
for (const d of pool) {
  if (used.length >= N_DISH) break;
  const r = await fetch(`${BASE}/imagery/realsense_overhead/${d.id}/rgb.png`); if (!r.ok) continue;
  const buf = Buffer.from(await r.arrayBuffer()); const img = await RawImage.fromBlob(new Blob([buf]));
  const s0 = Date.now(); d.embs = await embedImage(img); tScan += Date.now() - s0; used.push(d);
  if (used.length % 50 === 0) log('Fotos verarbeitet:', used.length);
}
log('Fotos:', used.length, '· Ø Rechenzeit je Scan (CPU, Node):', Math.round(tScan / used.length), 'ms');

// ---------- 4. Kalibrieren (Train) & Messen (Test) ----------
const cats = [...new Set(labels.filter((l) => l.cat !== 'nonfood').map((l) => l.cat))];
const nTrain = Math.round(used.length * 0.6), train = used.slice(0, nTrain), test = used.slice(nTrain);
const base = { topK: 8, ownMin: 0.5, foodMin: 0.5, minFrac: 0.03, k: 1, M: Object.fromEntries(cats.map((c) => [c, 300])) };
const feats = (d, C) => { const r = Core.analyze(d.embs, T, { ...C, M: Object.fromEntries(cats.map((c) => [c, 1])), minFrac: 0 }); const v = Object.fromEntries(cats.map((c) => [c, 0])); r.items.forEach((it) => { v[it.cat] += it.frac; }); return v; };
function fitM(set, C) { // Masse je Kategorie: Koordinatenabstieg auf log-Fehler, begrenzt
  const F = set.map((d) => feats(d, C)); const M = { ...C.M };
  const loss = () => set.reduce((s, d, i) => { const p = cats.reduce((a, c) => a + F[i][c] * M[c], 0); return s + Math.abs(Math.log((p + 20) / (d.mass + 20))); }, 0);
  for (let it = 0; it < 30; it++) for (const c of cats) { let best = M[c], bl = loss(); for (const f of [0.7, 0.85, 0.93, 1.07, 1.15, 1.4]) { const o = M[c]; M[c] = Math.min(2000, Math.max(30, o * f)); const l = loss(); if (l < bl) { bl = l; best = M[c]; } M[c] = o; } M[c] = best; }
  return M;
}
const kcalOf = (r) => r.items.reduce((s, it) => s + (it.kcal || 0), 0);
function evalSet(set, C) {
  const ae = [], ape = [], kae = [], kape = []; let hitTop = 0, nTop = 0;
  for (const d of set) {
    const r = Core.analyze(d.embs, T, C); const m = r.items.reduce((s, it) => s + it.grams, 0), k = kcalOf(r);
    ae.push(Math.abs(m - d.mass)); ape.push(Math.abs(m - d.mass) / d.mass); kae.push(Math.abs(k - d.kcal)); kape.push(Math.abs(k - d.kcal) / d.kcal);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }; const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { n: set.length, massMAE_g: Math.round(mean(ae)), massMAPE: +(mean(ape) * 100).toFixed(1), massMedAPE: +(med(ape) * 100).toFixed(1), kcalMAE: Math.round(mean(kae)), kcalMAPE: +(mean(kape) * 100).toFixed(1), kcalMedAPE: +(med(kape) * 100).toFixed(1), within20pct_kcal: +(kape.filter((x) => x <= 0.2).length / kape.length * 100).toFixed(1) };
}
// Varianten gegeneinander testen (Parameter der Kachel-Logik)
const variants = [];
for (const foodMin of [0.4, 0.5, 0.6]) for (const topK of [5, 8, 12]) for (const ownMin of [0.4, 0.6]) {
  const C = { ...base, foodMin, topK, ownMin }; C.M = fitM(train, C); variants.push({ C, tr: evalSet(train, C) });
}
variants.sort((a, b) => a.tr.kcalMAPE - b.tr.kcalMAPE);
const best = variants[0].C;
const meanMass = train.reduce((s, d) => s + d.mass, 0) / train.length, meanKcal = train.reduce((s, d) => s + d.kcal, 0) / train.length;
const baseline = { n: test.length, massMAPE: +(test.reduce((s, d) => s + Math.abs(meanMass - d.mass) / d.mass, 0) / test.length * 100).toFixed(1), kcalMAPE: +(test.reduce((s, d) => s + Math.abs(meanKcal - d.kcal) / d.kcal, 0) / test.length * 100).toFixed(1) };
const report = { date: new Date().toISOString(), model: MODEL + ' (vision q8)', dataset: 'Nutrition5k cafe1, realsense_overhead rgb (CC BY 4.0)', dishes: used.length, train: train.length, test: test.length,
  msPerScanNodeCPU: Math.round(tScan / used.length), best: { foodMin: best.foodMin, topK: best.topK, ownMin: best.ownMin }, M: best.M,
  testResult: evalSet(test, best), baselineMeanGuess: baseline, trainResult: variants[0].tr, variantsTried: variants.length, totalSeconds: Math.round((Date.now() - t0) / 1000) };
fs.writeFileSync('foodscan/calib.json', JSON.stringify({ ...best, measured: { test: report.testResult, baseline, n: used.length, date: report.date } }, null, 1));
fs.writeFileSync('foodscan/eval-report.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
