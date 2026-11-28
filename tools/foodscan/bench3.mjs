// FoodScan Phase 3 – Optimierung nur auf Cafe-1-Train (Validierung gruppiert nach Aufnahme-Serien),
// Tests: Cafe-1 offizieller Test (bekannt) + Cafe 2 (NEU, bisher unberührt, andere Kantine) als Abschlusstest.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { createRequire } from 'node:module';
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
const require = createRequire(import.meta.url); const Core = require(path.resolve('foodscan/foodscan-core.js'));
env.cacheDir = path.resolve('foodscan/models'); env.allowLocalModels = false;
const CACHE = '/tmp/fscache'; fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const T = JSON.parse(fs.readFileSync('foodscan/text-emb.json', 'utf8'));
const BASE = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset';
const get = async (u, tries = 3) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(u); if (r.ok) return r; if (r.status === 404) return null; } catch (e) {} await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } return null; };
const D = new Map();
for (const cafe of ['cafe1', 'cafe2']) { const txt = await (await get(`${BASE}/metadata/dish_metadata_${cafe}.csv`)).text();
  for (const line of txt.split('\n')) { const f = line.split(','); if (f.length < 6 || !/^dish_/.test(f[0])) continue; const ings = []; for (let i = 6; i + 6 < f.length; i += 7) ings.push({ name: f[i + 1], g: +f[i + 2], kcal: +f[i + 3] });
    D.set(f[0], { id: f[0], cafe, kcal: +f[1], mass: +f[2], ings }); } }
const ids = async (n) => (await (await get(`${BASE}/dish_ids/splits/${n}`)).text()).split(/\s+/).filter((x) => D.has(x));
const okD = (id) => { const d = D.get(id); return d.mass >= 10 && d.kcal > 0; };
const tr1 = (await ids('rgb_train_ids.txt')).filter((id) => D.get(id).cafe === 'cafe1' && okD(id)), te1 = (await ids('rgb_test_ids.txt')).filter((id) => D.get(id).cafe === 'cafe1' && okD(id));
const c2 = [...D.values()].filter((d) => d.cafe === 'cafe2' && okD(d.id)).map((d) => d.id);
log('Cafe1 train', tr1.length, 'test', te1.length, '· Cafe2 (neu)', c2.length);

const proc = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
const vm = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
async function embedImg(img) { const cs = Core.crops(img.width, img.height); const crs = []; for (const c of cs) crs.push(await img.crop([c.x, c.y, c.x + c.w - 1, c.y + c.h - 1]));
  const { image_embeds } = await vm(await proc(crs)); const d = image_embeds.dims[1]; return cs.map((_, i) => Array.from(image_embeds.data.subarray(i * d, (i + 1) * d), (x) => Math.round(x * 1e4) / 1e4)); }
const imgCache = new Map();
async function features(id, keepImg) {
  const fp = `${CACHE}/${id}.json.gz`; let o = fs.existsSync(fp) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(fp))) : null;
  if (o && !keepImg) return o;
  const r = await get(`${BASE}/imagery/realsense_overhead/${id}/rgb.png`); if (!r) return o;
  const img = await RawImage.fromBlob(new Blob([Buffer.from(await r.arrayBuffer())])); if (keepImg) imgCache.set(id, img);
  if (!o) { o = { embs: await embedImg(img) }; fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(o))); } return o;
}
async function load(list, tag, keepN = 0) { const out = []; let k = 0; for (const id of list) { const f = await features(id, k < keepN); if (!f) continue; k++; out.push({ ...D.get(id), embs: f.embs }); if (out.length % 250 === 0) log(tag, out.length); } return out; }
const train = await load(tr1, 'train'), test1 = await load(te1, 'test1'), final = await load(c2, 'cafe2', 200);
log('geladen: train', train.length, 'test1', test1.length, 'cafe2', final.length);

// ---------- Gruppierte Validierung (Serien = Aufnahmen mit < 10 min Abstand) ----------
const ts = (d) => +d.id.slice(5); const sorted = [...train].sort((a, b) => ts(a) - ts(b)); const groups = []; let g = [];
for (const d of sorted) { if (g.length && ts(d) - ts(g[g.length - 1]) > 600) { groups.push(g); g = []; } g.push(d); } if (g.length) groups.push(g);
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const gs = groups.sort(() => rnd() - 0.5); const fit = [], val = []; for (const gg of gs) (val.length < train.length * 0.2 ? val : fit).push(...gg);
log('Serien', groups.length, '· fit', fit.length, 'val', val.length);

// ---------- Merkmale ----------
const V = (d, kind) => Core.featVec(d.embs, T, kind, null);
const nrm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };
const lg = (v) => Math.log(v + 10), ex = (v) => Math.max(0, Math.exp(v) - 10);
function ridgeFit(X, y, lam) { const n = X.length, d = X[0].length, mu = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mu[j] += r[j] / n; for (const r of X) for (let j = 0; j < d; j++) sd[j] += (r[j] - mu[j]) ** 2 / n; for (let j = 0; j < d; j++) sd[j] = Math.max(1e-6, Math.sqrt(sd[j]));
  const Z = X.map((r) => r.map((x, j) => (x - mu[j]) / sd[j])); const ym = y.reduce((a, b) => a + b, 0) / n; const A = new Float64Array(d * d), b = new Float64Array(d);
  for (let i = 0; i < n; i++) { const z = Z[i], yy = y[i] - ym; for (let j = 0; j < d; j++) { b[j] += z[j] * yy; const zj = z[j]; if (!zj) continue; for (let k = j; k < d; k++) A[j * d + k] += zj * z[k]; } }
  for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j * d + k] = A[k * d + j]; A[j * d + j] += lam; }
  chol(A, d); const w = cholSolve(A, d, b); return { w: Array.from(w), mu, sd, ym }; }
function chol(A, d) { for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j * d + j] -= A[j * d + k] ** 2; A[j * d + j] = Math.sqrt(Math.max(1e-12, A[j * d + j])); for (let i = j + 1; i < d; i++) { let s = A[i * d + j]; for (let k = 0; k < j; k++) s -= A[i * d + k] * A[j * d + k]; A[i * d + j] = s / A[j * d + j]; } } }
function cholSolve(A, d, b) { const w = new Float64Array(d); for (let i = 0; i < d; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * d + k] * w[k]; w[i] = s / A[i * d + i]; } for (let i = d - 1; i >= 0; i--) { let s = w[i]; for (let k = i + 1; k < d; k++) s -= A[k * d + i] * w[k]; w[i] = s / A[i * d + i]; } return w; }
const ridgeP = (m, x) => { let s = m.ym; for (let j = 0; j < x.length; j++) s += m.w[j] * (x[j] - m.mu[j]) / m.sd[j]; return s; };
const dot = (a, b) => { let s = 0; for (let j = 0; j < a.length; j++) s += a[j] * b[j]; return s; };
function knnP(TV, Y, x, k, p) { const s = TV.map((v, i) => [dot(v, x), i]).sort((a, b) => b[0] - a[0]).slice(0, k); let ws = 0, ys = 0; for (const [sim, i] of s) { const w = Math.max(1e-6, sim) ** p; ws += w; ys += w * Y[i]; } return ys / ws; }
// Kernel-Ridge (RBF auf Kosinus-Abstand) – nichtlinear, gleiche Trainingsdaten wie kNN
function krrFit(TV, y, gam, lam) { const n = TV.length, A = new Float64Array(n * n), ym = y.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { const k = Math.exp(-gam * (1 - dot(TV[i], TV[j]))); A[i * n + j] = k; A[j * n + i] = k; } for (let i = 0; i < n; i++) A[i * n + i] += lam;
  chol(A, n); return { alpha: Array.from(cholSolve(A, n, Float64Array.from(y, (v) => v - ym))), ym, gam }; }
const krrP = (m, TV, x) => { let s = m.ym; for (let i = 0; i < TV.length; i++) s += m.alpha[i] * Math.exp(-m.gam * (1 - dot(TV[i], x))); return s; };

function metrics(pred, truth) { const n = pred.length, e = pred.map((p, i) => p - truth[i]), ae = e.map(Math.abs), ape = ae.map((a, i) => a / truth[i]);
  const s = [...ape].sort((a, b) => a - b), q = (f) => s[Math.floor(f * (n - 1))], sum = (a) => a.reduce((x, y) => x + y, 0), pc = (x) => +(x * 100).toFixed(1);
  return { n, MAE: +(sum(ae) / n).toFixed(1), MAPE: pc(sum(ape) / n), MedAPE: pc(q(0.5)), WAPE: pc(sum(ae) / sum(truth)), P90: pc(q(0.9)), MAX: pc(s[n - 1]), bias: pc(sum(e) / sum(truth)), lt5: pc(ape.filter((x) => x < 0.05).length / n), lt10: pc(ape.filter((x) => x < 0.1).length / n), lt20: pc(ape.filter((x) => x < 0.2).length / n) }; }

// ---------- Kandidaten-Verfahren (nur auf fit trainiert, auf val bewertet) ----------
const KIND = 'clip';
const X = { fit: fit.map((d) => V(d, KIND)), val: val.map((d) => V(d, KIND)), all: train.map((d) => V(d, KIND)) };
const N = { fit: X.fit.map(nrm), val: X.val.map(nrm), all: X.all.map(nrm) };
const Y = (set, key) => set.map((d) => lg(d[key]));
function predictors(trX, trN, trSet, key) {
  const out = {};
  for (const lam of [300, 1000]) { const m = ridgeFit(trX, Y(trSet, key), lam); out[`ridge${lam}`] = (x, n) => ridgeP(m, x); }
  const yy = Y(trSet, key); for (const k of [5, 10]) out[`knn${k}`] = (x, n) => knnP(trN, yy, n, k, 16);
  for (const gam of [10, 25]) for (const lam of [0.3, 1]) { const m = krrFit(trN, yy, gam, lam); out[`krr${gam}_${lam}`] = (x, n) => krrP(m, trN, n); }
  return out;
}
log('Trainiere Kandidaten …');
const P = { kcal: predictors(X.fit, N.fit, fit, 'kcal'), mass: predictors(X.fit, N.fit, fit, 'mass') };
const pv = {}; for (const key of ['kcal', 'mass']) { pv[key] = {}; for (const [nm, f] of Object.entries(P[key])) pv[key][nm] = X.val.map((x, i) => f(x, N.val[i])); }
const tv = { kcal: val.map((d) => d.kcal), mass: val.map((d) => d.mass) };
// Ensembles aus bis zu 3 Verfahren, Gewichte grob gerastert; Bias-Korrektur per log-Offset
const names = Object.keys(pv.kcal); const combos = [];
for (let a = 0; a < names.length; a++) for (let b = a; b < names.length; b++) for (let c = b; c < names.length; c++) combos.push([names[a], names[b], names[c]]);
function evalCombo(key, combo, off) { const p = val.map((_, i) => ex(combo.reduce((s, nm) => s + pv[key][nm][i], 0) / combo.length + off)); return metrics(p, tv[key]); }
function bestOff(key, combo, mode) { let best = null; for (let o = -0.1; o <= 0.4001; o += 0.01) { const m = evalCombo(key, combo, o); const score = mode === 'bias' ? (Math.abs(m.bias) <= 2 ? m.WAPE : 1e3 + Math.abs(m.bias)) : m.WAPE; if (!best || score < best.score) best = { o: +o.toFixed(2), m, score }; } return best; }
const res = {}; for (const key of ['kcal', 'mass']) { const r = combos.map((c) => ({ c, b: bestOff(key, c, 'bias') })).sort((x, y) => x.b.score - y.b.score); res[key] = r; }
const chosen = { kcal: res.kcal[0], mass: res.mass[0] };
const phase2 = { kcal: { c: ['ridge300', 'knn5', 'knn5'], o: 0 } };
const R = { split: { fit: fit.length, val: val.length, series: groups.length, test1: test1.length, cafe2Final: final.length },
  validation: { phase2Approx: evalCombo('kcal', ['ridge300', 'knn5'], 0), top5kcal: res.kcal.slice(0, 5).map((x) => ({ combo: x.c.join('+'), off: x.b.o, ...x.b.m })), chosenMass: { combo: chosen.mass.c.join('+'), off: chosen.mass.b.o, ...chosen.mass.b.m } } };
log('Gewählt kcal:', chosen.kcal.c.join('+'), 'offset', chosen.kcal.b.o, JSON.stringify(chosen.kcal.b.m));

// Unsicherheitsbereich (80 %) aus Validierungs-Residuen je vorhergesagter Größe
const vp = val.map((_, i) => chosen.kcal.c.reduce((s, nm) => s + pv.kcal[nm][i], 0) / chosen.kcal.c.length + chosen.kcal.b.o);
const bands = [[0, 100], [100, 300], [300, 1e9]].map(([lo, hi]) => { const r = val.map((d, i) => [ex(vp[i]), Math.log(d.kcal / Math.max(1, ex(vp[i])))]).filter(([p]) => p >= lo && p < hi).map(([, x]) => x).sort((a, b) => a - b);
  const q = (f) => r[Math.floor(f * (r.length - 1))]; return { lo, hi, n: r.length, q10: +Math.exp(q(0.1)).toFixed(3), q90: +Math.exp(q(0.9)).toFixed(3) }; });
R.interval80 = bands;

// ---------- Endmodell: auf ganz Cafe-1-Train neu trainieren, dann EINMAL testen ----------
log('Endmodell trainieren …');
const PF = { kcal: predictors(X.all, N.all, train, 'kcal'), mass: predictors(X.all, N.all, train, 'mass') };
const predSet = (set, key, ch) => set.map((d) => { const x = V(d, KIND), n = nrm(x); return ex(ch.c.reduce((s, nm) => s + PF[key][nm](x, n), 0) / ch.c.length + ch.b.o); });
const p2 = (set) => { const x = set.map((d) => V(d, KIND)); const m = ridgeFit(X.all, Y(train, 'kcal'), 300), yy = Y(train, 'kcal'); return x.map((v) => ex(0.5 * ridgeP(m, v) + 0.5 * knnP(N.all, yy, nrm(v), 5, 16))); };
const inBand = (set, pk) => { let c = 0; set.forEach((d, i) => { const b = bands.find((x) => pk[i] >= x.lo && pk[i] < x.hi); if (d.kcal >= pk[i] * b.q10 && d.kcal <= pk[i] * b.q90) c++; }); return +(c / set.length * 100).toFixed(1); };
for (const [nm, set] of [['test1_cafe1', test1], ['final_cafe2', final]]) {
  const pk = predSet(set, 'kcal', chosen.kcal), pm = predSet(set, 'mass', chosen.mass), pk2 = p2(set);
  R[nm] = { phase2: metrics(pk2, set.map((d) => d.kcal)), phase3kcal: metrics(pk, set.map((d) => d.kcal)), phase3mass: metrics(pm, set.map((d) => d.mass)), intervalCoverage80: inBand(set, pk),
    byKcal: Object.fromEntries([['<100', (d) => d.kcal < 100], ['100-400', (d) => d.kcal >= 100 && d.kcal < 400], ['>=400', (d) => d.kcal >= 400]].map(([k, f]) => { const ii = set.map((d, i) => [d, i]).filter(([d]) => f(d)); return [k, metrics(ii.map(([, i]) => pk[i]), ii.map(([d]) => d.kcal))]; })) };
  if (nm === 'final_cafe2') { // schlechteste 10 %
    const ape = set.map((d, i) => ({ d, i, e: Math.abs(pk[i] - d.kcal) / d.kcal, s: Math.sign(pk[i] - d.kcal) })).sort((a, b) => b.e - a.e); const w = ape.slice(0, Math.ceil(set.length * 0.1));
    const cnt = {}; w.forEach(({ d }) => { const top = [...d.ings].sort((a, b) => b.g - a.g)[0]; const k = top ? top.name : '?'; cnt[k] = (cnt[k] || 0) + 1; });
    R.worst10 = { n: w.length, medianTrueKcal: [...w.map(({ d }) => d.kcal)].sort((a, b) => a - b)[Math.floor(w.length / 2)], share_kcal_lt100: +(w.filter(({ d }) => d.kcal < 100).length / w.length * 100).toFixed(1), overestimated: +(w.filter((x) => x.s > 0).length / w.length * 100).toFixed(1),
      share_1_2_ingredients: +(w.filter(({ d }) => d.ings.length <= 2).length / w.length * 100).toFixed(1), topMainIngredients: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12), examples: w.slice(0, 8).map(({ d, i }) => ({ id: d.id, true: Math.round(d.kcal), pred: Math.round(pk[i]), ings: d.ings.slice(0, 4).map((x) => x.name + ' ' + Math.round(x.g) + 'g').join(', ') })) };
  }
}
// ---------- Robustheit: Licht, Drehung, Ausschnitt, Farbe (200 Cafe-2-Bilder) ----------
async function aug(img, kind) {
  if (kind === 'rot90') return await img.rotate ? img : img;
  const cv = img.clone(); const d = cv.data, ch = cv.channels;
  if (kind === 'dark') for (let i = 0; i < d.length; i++) d[i] = Math.round(d[i] * 0.65);
  if (kind === 'bright') for (let i = 0; i < d.length; i++) d[i] = Math.min(255, Math.round(d[i] * 1.35));
  if (kind === 'warm') for (let i = 0; i < d.length; i += ch) { d[i] = Math.min(255, Math.round(d[i] * 1.12)); d[i + 2] = Math.round(d[i + 2] * 0.85); }
  if (kind === 'zoom') { const w = cv.width, h = cv.height, mx = Math.round(w * 0.08), my = Math.round(h * 0.08); return await cv.crop([mx, my, w - mx - 1, h - my - 1]); }
  if (kind === 'wide') { return await cv.pad ? cv : cv; }
  return cv;
}
const rob = {}; const sub = final.filter((d) => imgCache.has(d.id)).slice(0, 200);
if (sub.length) { const base = sub.map((d) => d.embs); const bp = predSet(sub, 'kcal', chosen.kcal);
  for (const k of ['dark', 'bright', 'warm', 'zoom']) { const pk = []; for (const d of sub) { const im = await aug(imgCache.get(d.id), k); const embs = await embedImg(im); const x = Core.featVec(embs, T, KIND, null), n = nrm(x); pk.push(ex(chosen.kcal.c.reduce((s, nm) => s + PF.kcal[nm](x, n), 0) / chosen.kcal.c.length + chosen.kcal.b.o)); }
    const ch = pk.map((p, i) => Math.abs(p - bp[i]) / Math.max(1, bp[i])).sort((a, b) => a - b); rob[k] = { kcal: metrics(pk, sub.map((d) => d.kcal)), medianChangeVsOriginal: +(ch[Math.floor(ch.length / 2)] * 100).toFixed(1) }; log('Robustheit', k, rob[k].kcal.MedAPE); }
  rob.original = metrics(bp, sub.map((d) => d.kcal)); }
R.robustness = rob;

// ---------- Export ----------
const used = [...new Set([...chosen.kcal.c, ...chosen.mass.c])];
const pack = (m) => ({ w: m.w.map((x) => +x.toPrecision(6)), mu: m.mu.map((x) => +x.toPrecision(7)), sd: m.sd.map((x) => +x.toPrecision(6)), ym: m.ym });
const exp = { version: 4, kind: KIND, kcal: { combo: chosen.kcal.c, off: chosen.kcal.b.o }, mass: { combo: chosen.mass.c, off: chosen.mass.b.o }, bands, comps: {} };
for (const key of ['kcal', 'mass']) for (const nm of used) { if (nm.startsWith('ridge')) exp.comps[`${key}:${nm}`] = { type: 'ridge', ...pack(ridgeFit(X.all, Y(train, key), +nm.slice(5))) };
  if (nm.startsWith('knn')) exp.comps[`${key}:${nm}`] = { type: 'knn', k: +nm.slice(3), p: 16 };
  if (nm.startsWith('krr')) { const [gam, lam] = nm.slice(3).split('_').map(Number); const m = krrFit(N.all, Y(train, key), gam, lam); exp.comps[`${key}:${nm}`] = { type: 'krr', gam, ym: m.ym, alpha: m.alpha.map((x) => +x.toPrecision(6)) }; } }
const dim = N.all[0].length, q8 = Buffer.alloc(N.all.length * dim); N.all.forEach((v, i) => v.forEach((x, j) => q8.writeInt8(Math.max(-127, Math.min(127, Math.round(x * 254))), i * dim + j)));
exp.train = { dim, n: N.all.length, q: q8.toString('base64'), scale: 1 / 254, kcal: Y(train, 'kcal').map((x) => +x.toFixed(4)), mass: Y(train, 'mass').map((x) => +x.toFixed(4)) };
exp.measured = { date: new Date().toISOString(), final: R.final_cafe2, test1: R.test1_cafe1, split: R.split };
fs.writeFileSync('foodscan/model3.json', JSON.stringify(exp)); fs.writeFileSync('foodscan/bench3-report.json', JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1)); log('model3.json', Math.round(fs.statSync('foodscan/model3.json').size / 1024), 'KB');
