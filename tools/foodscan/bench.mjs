// FoodScan Phase 2 – Benchmark & Optimierung (GitHub Actions)
// Offizielle Nutrition5k-Splits (Serien desselben Tellers liegen nie in Train UND Test).
// Train → Optimierung (davon 20 % Validierung zur Methodenauswahl), Test → nur einmalige unabhängige Messung.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage, pipeline } from '@huggingface/transformers';
const require = createRequire(import.meta.url);
const Core = require(path.resolve('foodscan/foodscan-core.js'));
env.cacheDir = path.resolve('foodscan/models'); env.allowLocalModels = false;
const N_TRAIN = +(process.env.N_TRAIN || 1200), N_TEST = +(process.env.N_TEST || 600), USE_DEPTH = process.env.DEPTH !== '0';
const CACHE = '/tmp/fscache'; fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const T = JSON.parse(fs.readFileSync('foodscan/text-emb.json', 'utf8'));
const BASE = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset';
const get = async (u, tries = 3) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(u); if (r.ok) return r; if (r.status === 404) return null; } catch (e) {} await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } return null; };

// ---------- Daten ----------
const meta = await (await get(`${BASE}/metadata/dish_metadata_cafe1.csv`)).text();
const D = new Map();
for (const line of meta.split('\n')) { const f = line.split(','); if (f.length < 6 || !/^dish_/.test(f[0])) continue;
  const ings = []; for (let i = 6; i + 6 < f.length; i += 7) ings.push({ name: f[i + 1], g: +f[i + 2], kcal: +f[i + 3] });
  D.set(f[0], { id: f[0], kcal: +f[1], mass: +f[2], ings }); }
const ids = async (n) => (await (await get(`${BASE}/dish_ids/splits/${n}`)).text()).split(/\s+/).filter((x) => D.has(x));
const trainIds = await ids('rgb_train_ids.txt'), testIds = await ids('rgb_test_ids.txt');
log('Split: train', trainIds.length, 'test', testIds.length, '· Überschneidung:', trainIds.filter((x) => testIds.includes(x)).length);
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (arr, n) => arr.filter((id) => { const d = D.get(id); return d.mass >= 10 && d.kcal > 0; }).sort(() => rnd() - 0.5).slice(0, Math.round(n * 1.15));

// ---------- Merkmale (mit Cache) ----------
const proc = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
const vmodel = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
let depth = null;
if (USE_DEPTH) { for (const dt of ['q8', 'fp16', 'fp32']) { try { depth = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: dt }); log('Depth Anything V2 Small geladen:', dt); depth.dt = dt; break; } catch (e) { log('depth', dt, 'nicht verfügbar'); } } }
const tStat = { clip: 0, depth: 0, n: 0 };
async function features(id) {
  const fp = `${CACHE}/${id}.json.gz`; if (fs.existsSync(fp)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)));
  const r = await get(`${BASE}/imagery/realsense_overhead/${id}/rgb.png`); if (!r) return null;
  const img = await RawImage.fromBlob(new Blob([Buffer.from(await r.arrayBuffer())]));
  const cs = Core.crops(img.width, img.height); const embs = []; let t0 = Date.now();
  for (const c of cs) { const cr = await img.crop([c.x, c.y, c.x + c.w - 1, c.y + c.h - 1]); const { image_embeds } = await vmodel(await proc(cr)); embs.push(Array.from(image_embeds.data, (x) => Math.round(x * 1e4) / 1e4)); }
  tStat.clip += Date.now() - t0; let dep = null;
  if (depth) { t0 = Date.now(); const sq = await img.crop([cs[0].x, cs[0].y, cs[0].x + cs[0].w - 1, cs[0].y + cs[0].h - 1]); const out = await depth(sq); tStat.depth += Date.now() - t0;
    const P = out.predicted_depth, [h, w] = P.dims.slice(-2), a = P.data; // relative inverse Tiefe (größer = näher)
    // 8×8 Rasterwerte (Mittel) + Perzentile → Höhenprofil relativ zum Teller
    const G = 8, grid = new Array(G * G).fill(0), cnt = new Array(G * G).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = Math.min(G - 1, Math.floor(y / h * G)) * G + Math.min(G - 1, Math.floor(x / w * G)); grid[k] += a[y * w + x]; cnt[k]++; }
    const s = [...a].sort((p, q) => p - q), q = (f) => s[Math.floor(f * (s.length - 1))];
    dep = { grid: grid.map((v, i) => Math.round(v / cnt[i] * 1000) / 1000), p: [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98].map((f) => Math.round(q(f) * 1000) / 1000) }; }
  tStat.n++;
  const o = { embs, dep }; fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(o))); return o;
}
async function load(list, n, tag) { const out = []; for (const id of list) { if (out.length >= n) break; const f = await features(id); if (!f) continue; out.push({ ...D.get(id), ...f }); if (out.length % 100 === 0) log(tag, out.length); } return out; }
const test = await load(testIds.filter((id) => { const d = D.get(id); return d.mass >= 10 && d.kcal > 0; }), 1e9, 'test');
const train = await load(pick(trainIds, N_TRAIN), N_TRAIN, 'train');
log('Merkmale fertig. train', train.length, 'test', test.length, tStat.n ? `· Ø CLIP ${Math.round(tStat.clip / tStat.n)} ms, Ø Depth ${Math.round(tStat.depth / tStat.n)} ms (neu berechnet: ${tStat.n})` : '(aus Cache)');
const nVal = Math.round(train.length * 0.2), val = train.slice(0, nVal), fit = train.slice(nVal);

// ---------- Merkmalsvektoren ----------
const L = T.labels, nL = L.length, isFood = L.map((l) => l.cat !== 'nonfood');
const nrm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); };
function vec(d, kind) {
  const E = d.embs.map(nrm); const whole = E[0];
  if (kind === 'whole') return whole;
  const mean = new Array(512).fill(0); for (let t = 1; t < E.length; t++) for (let j = 0; j < 512; j++) mean[j] += E[t][j] / (E.length - 1);
  const r = Core.analyze(d.embs, T, { topK: 12, ownMin: 0.4, foodMin: 0.6, minFrac: 0, M: {}, k: 1 });
  const cats = {}; r.items.forEach((it) => { cats[it.cat] = (cats[it.cat] || 0) + it.frac; });
  const catv = ['grain', 'dish', 'bread', 'potato', 'meat', 'fish', 'egg', 'veg', 'leafy', 'fruit', 'dairy', 'sauce', 'soup', 'dessert', 'nuts'].map((c) => cats[c] || 0);
  let v = [...whole, ...nrm(mean), r.foodFrac, ...catv];
  if (kind === 'clip+depth' && d.dep) { const g = d.dep.grid, mn = Math.min(...g), mx = Math.max(...g) || 1; const gn = g.map((x) => (x - mn) / (mx - mn + 1e-6));
    const p = d.dep.p, rng = (p[6] - p[0]) || 1; v = [...v, ...gn, ...p.map((x) => (x - p[0]) / rng), gn.reduce((a, b) => a + b, 0) / gn.length]; }
  return v;
}
// ---------- Ridge-Regression (geschlossen, Cholesky) ----------
function ridgeFit(X, y, lam) {
  const n = X.length, d = X[0].length, mu = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mu[j] += r[j] / n; for (const r of X) for (let j = 0; j < d; j++) sd[j] += (r[j] - mu[j]) ** 2 / n; for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => r.map((x, j) => (x - mu[j]) / sd[j])); const ym = y.reduce((a, b) => a + b, 0) / n;
  const A = new Float64Array(d * d), b = new Float64Array(d);
  for (let i = 0; i < n; i++) { const z = Z[i], yy = y[i] - ym; for (let j = 0; j < d; j++) { b[j] += z[j] * yy; const zj = z[j]; if (!zj) continue; for (let k = j; k < d; k++) A[j * d + k] += zj * z[k]; } }
  for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j * d + k] = A[k * d + j]; A[j * d + j] += lam; }
  for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) A[j * d + j] -= A[j * d + k] ** 2; A[j * d + j] = Math.sqrt(A[j * d + j]); for (let i = j + 1; i < d; i++) { let s = A[i * d + j]; for (let k = 0; k < j; k++) s -= A[i * d + k] * A[j * d + k]; A[i * d + j] = s / A[j * d + j]; } }
  const w = new Float64Array(d); for (let i = 0; i < d; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i * d + k] * w[k]; w[i] = s / A[i * d + i]; }
  for (let i = d - 1; i >= 0; i--) { let s = w[i]; for (let k = i + 1; k < d; k++) s -= A[k * d + i] * w[k]; w[i] = s / A[i * d + i]; }
  return { w: Array.from(w), mu, sd, ym };
}
const ridgePred = (m, x) => { let s = m.ym; for (let j = 0; j < x.length; j++) s += m.w[j] * (x[j] - m.mu[j]) / m.sd[j]; return s; };
const lg = (v) => Math.log(v + 10), ex = (v) => Math.max(0, Math.exp(v) - 10);
// ---------- kNN (ähnliche Gerichte) ----------
function knnPred(trainV, trainY, x, k, p) { const s = trainV.map((v, i) => [v.reduce((a, b, j) => a + b * x[j], 0), i]).sort((a, b) => b[0] - a[0]).slice(0, k); let ws = 0, ys = 0; for (const [sim, i] of s) { const w = Math.max(1e-6, sim) ** p; ws += w; ys += w * trainY[i]; } return ys / ws; }

// ---------- Metriken ----------
function metrics(pred, truth) {
  const n = pred.length, e = pred.map((p, i) => p - truth[i]), ae = e.map(Math.abs), ape = ae.map((a, i) => a / truth[i]);
  const s = [...ape].sort((a, b) => a - b), q = (f) => s[Math.floor(f * (n - 1))];
  const sum = (a) => a.reduce((x, y) => x + y, 0), pc = (x) => +(x * 100).toFixed(1);
  return { n, MAE: +(sum(ae) / n).toFixed(1), MAPE: pc(sum(ape) / n), MedAPE: pc(q(0.5)), WAPE: pc(sum(ae) / sum(truth)), P90: pc(q(0.9)), MAX: pc(s[n - 1]),
    bias: pc(sum(e) / sum(truth)), lt5: pc(ape.filter((x) => x < 0.05).length / n), lt10: pc(ape.filter((x) => x < 0.1).length / n), lt20: pc(ape.filter((x) => x < 0.2).length / n) };
}
const by = (set, pred, key, f) => { const g = {}; set.forEach((d, i) => { const k = f(d); (g[k] = g[k] || { p: [], t: [] }).p.push(pred[i]); g[k].t.push(d[key]); }); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, metrics(v.p, v.t)])); };
const massB = (d) => d.mass < 150 ? 'a<150g' : d.mass < 400 ? 'b150-400g' : 'c>=400g', ingB = (d) => d.ings.length <= 2 ? 'a1-2' : d.ings.length <= 5 ? 'b3-5' : 'c6+', kcalB = (d) => d.kcal < 100 ? 'a<100kcal' : d.kcal < 400 ? 'b100-400' : 'c>=400';

// ---------- Methoden ----------
const R = { split: { train: fit.length, val: val.length, test: test.length, officialSplitOverlap: 0 } };
// M0: bisherige Flächenmethode (vorher) mit bisheriger Kalibrierung
const C0 = JSON.parse(fs.readFileSync('foodscan/calib.json', 'utf8'));
const m0 = (d) => { const r = Core.analyze(d.embs, T, C0); return { mass: r.items.reduce((s, it) => s + it.grams, 0), kcal: r.items.reduce((s, it) => s + (it.kcal || 0), 0), r }; };
const cand = {};
const kinds = ['whole', 'clip', ...(depth ? ['clip+depth'] : [])].filter((k) => k !== 'clip+depth' || process.env.ALLOW_DEPTH === '1');
const V = {}; for (const k of kinds) V[k] = { fit: fit.map((d) => vec(d, k)), val: val.map((d) => vec(d, k)), test: test.map((d) => vec(d, k)), all: train.map((d) => vec(d, k)) };
for (const k of kinds) for (const lam of [100, 300, 1000, 3000, 10000]) {
  const mM = ridgeFit(V[k].fit, fit.map((d) => lg(d.mass)), lam), mK = ridgeFit(V[k].fit, fit.map((d) => lg(d.kcal)), lam);
  const pv = V[k].val.map((x) => ({ mass: ex(ridgePred(mM, x)), kcal: ex(ridgePred(mK, x)) }));
  cand[`ridge:${k}:λ${lam}`] = { val: metrics(pv.map((p) => p.kcal), val.map((d) => d.kcal)), valMass: metrics(pv.map((p) => p.mass), val.map((d) => d.mass)), kind: k, lam, type: 'ridge' };
}
for (const k of ['whole', 'clip']) for (const kk of [3, 5, 10, 20]) for (const p of [1, 8, 16]) {
  const tv = V[k].fit.map(nrm), pv = V[k].val.map(nrm).map((x) => ({ mass: ex(knnPred(tv, fit.map((d) => lg(d.mass)), x, kk, p)), kcal: ex(knnPred(tv, fit.map((d) => lg(d.kcal)), x, kk, p)) }));
  cand[`knn:${k}:k${kk}:p${p}`] = { val: metrics(pv.map((q) => q.kcal), val.map((d) => d.kcal)), valMass: metrics(pv.map((q) => q.mass), val.map((d) => d.mass)), kind: k, k: kk, p, type: 'knn' };
}
const ranked = Object.entries(cand).sort((a, b) => a[1].val.WAPE - b[1].val.WAPE);
R.validationTop = ranked.slice(0, 8).map(([n, c]) => ({ n, kcal: c.val, mass: c.valMass }));
const bestR = ranked.find(([n]) => n.startsWith('ridge'))[1], bestK = ranked.find(([n]) => n.startsWith('knn'))[1];
// Ensemble-Gewicht auf Validierung bestimmen
const predWith = (c, trainSet, trainV, xs, key) => c.type === 'ridge' ? (() => { const m = ridgeFit(trainV, trainSet.map((d) => lg(d[key])), c.lam); return xs.map((x) => ridgePred(m, x)); })()
  : (() => { const tv = trainV.map(nrm); return xs.map((x) => knnPred(tv, trainSet.map((d) => lg(d[key])), nrm(x), c.k, c.p)); })();
let bestA = 0.5, bestW = 1e9; const rv = predWith(bestR, fit, V[bestR.kind].fit, V[bestR.kind].val, 'kcal'), kv = predWith(bestK, fit, V[bestK.kind].fit, V[bestK.kind].val, 'kcal');
for (const a of [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]) { const w = metrics(rv.map((x, i) => ex(a * x + (1 - a) * kv[i])), val.map((d) => d.kcal)).WAPE; if (w < bestW) { bestW = w; bestA = a; } }
const offs = {}; for (const key of ['kcal', 'mass']) { const rv2 = predWith(bestR, fit, V[bestR.kind].fit, V[bestR.kind].val, key), kv3 = predWith(bestK, fit, V[bestK.kind].fit, V[bestK.kind].val, key); let bo = 0, bw = 1e9;
  for (let o = -0.1; o <= 0.3001; o += 0.02) { const w = metrics(rv2.map((x, i) => ex(bestA * x + (1 - bestA) * kv3[i] + o)), val.map((d) => d[key])).WAPE; if (w < bw) { bw = w; bo = o; } } offs[key] = +bo.toFixed(2); }
R.chosen = { offsets: offs, ridge: bestR.kind + ' λ' + bestR.lam, knn: `${bestK.kind} k${bestK.k} p${bestK.p}`, ensembleRidgeWeight: bestA, valWAPE: bestW };

// ---------- Einmalige Messung auf Test (vorher vs. nachher) ----------
const before = test.map(m0);
const fullTrain = train;
const tr = (key) => predWith(bestR, fullTrain, V[bestR.kind].all, V[bestR.kind].test, key), tk = (key) => predWith(bestK, fullTrain, V[bestK.kind].all, V[bestK.kind].test, key);
const rK = tr('kcal'), kK = tk('kcal'), rM = tr('mass'), kM = tk('mass');
const afterK = rK.map((x, i) => ex(bestA * x + (1 - bestA) * kK[i] + offs.kcal)), afterM = rM.map((x, i) => ex(bestA * x + (1 - bestA) * kM[i] + offs.mass));
const wholeOnly = (() => { const m = ridgeFit(V.whole.all, train.map((d) => lg(d.kcal)), 1000); return V.whole.test.map((x) => ex(ridgePred(m, x))); })();
const tK = test.map((d) => d.kcal), tM = test.map((d) => d.mass);
R.test = {
  before: { kcal: metrics(before.map((b) => b.kcal), tK), mass: metrics(before.map((b) => b.mass), tM) },
  after: { kcal: metrics(afterK, tK), mass: metrics(afterM, tM) },
  ridgeOnly: { kcal: metrics(rK.map(ex), tK) }, wholeImageOnlyRidge: { kcal: metrics(wholeOnly, tK) }, knnOnly: { kcal: metrics(kK.map(ex), tK) },
  baselineTrainMean: { kcal: metrics(tK.map(() => train.reduce((s, d) => s + d.kcal, 0) / train.length), tK) },
  afterByMass: by(test, afterK, 'kcal', massB), afterByIngredients: by(test, afterK, 'kcal', ingB), afterByKcal: by(test, afterK, 'kcal', kcalB),
  beforeByKcal: by(test, before.map((b) => b.kcal), 'kcal', kcalB), beforeByIngredients: by(test, before.map((b) => b.kcal), 'kcal', ingB),
};
// Fehlerzerlegung der bisherigen Methode: Gewicht vs. Energiedichte (Erkennung + Nährwertzuordnung)
const bm = before.map((b) => b.mass), bk = before.map((b) => b.kcal);
R.test.beforeDecomposition = {
  massOnly_kcalWithTrueDensity: metrics(test.map((d, i) => bm[i] * d.kcal / d.mass), tK),
  densityOnly_kcalWithTrueMass: metrics(test.map((d, i) => d.mass * (bm[i] ? bk[i] / bm[i] : 1.5)), tK),
};
R.test.afterDecomposition = { massOnly_kcalWithTrueDensity: metrics(test.map((d, i) => afterM[i] * d.kcal / d.mass), tK), densityOnly_kcalWithTrueMass: metrics(test.map((d, i) => d.mass * afterK[i] / Math.max(1, afterM[i])), tK) };
// Erkennung: Hauptzutat (größte Masse) unter erkannten Lebensmitteln?
const MAP = [[/rice/, ['rice', 'brownrice', 'fried_rice']], [/chicken/, ['chicken_breast', 'chicken_pieces', 'chicken_wings', 'fried_chicken']], [/broccoli/, ['broccoli']], [/potato/, ['potato_boiled', 'roast_potato', 'mashed', 'fries', 'sweet_potato']], [/egg/, ['egg_fried', 'egg_scrambled', 'egg_boiled', 'omelette']],
  [/salad|lettuce|greens|arugula|spinach|kale/, ['salad', 'mixed_salad', 'spinach']], [/carrot/, ['carrots']], [/beef|steak/, ['beef_steak', 'ground_beef', 'meatballs']], [/pork|bacon/, ['pork', 'bacon']], [/fish|salmon|cod|tuna/, ['salmon', 'white_fish', 'tuna']],
  [/pasta|noodle/, ['pasta', 'noodles_asian', 'spaghetti_tomato']], [/bread|toast|bagel/, ['bread', 'toast', 'bread_roll']], [/apple/, ['apple']], [/banana/, ['banana']], [/berr/, ['strawberries', 'blueberries', 'raspberries']], [/melon/, ['melon', 'watermelon']], [/grape/, ['grapes']], [/pineapple/, ['pineapple']],
  [/tomato/, ['tomato', 'tomato_sauce']], [/cucumber/, ['cucumber']], [/bean/, ['beans', 'green_beans']], [/corn/, ['corn']], [/cauliflower/, ['cauliflower']], [/brussels/, ['brussels']], [/cheese/, ['cheese', 'feta', 'mozzarella', 'cottage']], [/yogurt/, ['yogurt']], [/quinoa/, ['quinoa']], [/olive/, ['olives']], [/pepper/, ['bell_pepper']], [/squash|zucchini/, ['zucchini']], [/asparagus/, ['asparagus']], [/mushroom/, ['mushrooms']], [/tofu/, ['tofu']], [/shrimp/, ['shrimp']], [/turkey/, ['turkey']], [/sausage/, ['sausage']], [/pizza/, ['pizza']], [/hummus/, ['hummus']], [/oat/, ['oatmeal', 'granola']]];
let rec = 0, recN = 0; const perKey = {};
test.forEach((d, i) => { const top = [...d.ings].sort((a, b) => b.g - a.g)[0]; if (!top) return; const m = MAP.find(([re]) => re.test(top.name.toLowerCase())); if (!m) return; recN++;
  const got = before[i].r.items.map((x) => x.k); const ok = m[1].some((k) => got.includes(k)); if (ok) rec++; const key = m[1][0]; perKey[key] = perKey[key] || [0, 0]; perKey[key][1]++; if (ok) perKey[key][0]++; });
R.test.recognitionMainIngredient = { recall: +(rec / recN * 100).toFixed(1), n: recN, perClass: Object.fromEntries(Object.entries(perKey).filter(([, v]) => v[1] >= 5).map(([k, v]) => [k, `${v[0]}/${v[1]}`])) };
R.speed = { msClipPerScanNode: tStat.n ? Math.round(tStat.clip / tStat.n) : null, msDepthPerScanNode: tStat.n ? Math.round(tStat.depth / tStat.n) : null, depthDtype: depth && depth.dt };

// ---------- Export fürs Handy (bestes Verfahren, trainiert auf allen Train-Daten) ----------
const kindX = bestR.kind; const needDepth = kindX === 'clip+depth' || bestK.kind === 'clip+depth';
const exp = { version: 3, offsets: offs, ridgeKind: kindX, ridgeLam: bestR.lam, a: bestA, knn: { kind: bestK.kind, k: bestK.k, p: bestK.p }, needDepth };
const fM = ridgeFit(V[kindX].all, train.map((d) => lg(d.mass)), bestR.lam), fK = ridgeFit(V[kindX].all, train.map((d) => lg(d.kcal)), bestR.lam);
const pack = (m) => ({ w: m.w.map((x) => +x.toPrecision(6)), mu: m.mu.map((x) => +x.toPrecision(7)), sd: m.sd.map((x) => +x.toPrecision(6)), ym: m.ym });
exp.ridgeMass = pack(fM); exp.ridgeKcal = pack(fK);
const kv2 = V[bestK.kind].all.map(nrm); const q8 = Buffer.alloc(kv2.length * kv2[0].length); kv2.forEach((v, i) => v.forEach((x, j) => q8.writeInt8(Math.max(-127, Math.min(127, Math.round(x * 127 / 0.5))), i * v.length + j)));
exp.knnData = { dim: kv2[0].length, n: kv2.length, q: q8.toString('base64'), scale: 0.5 / 127, mass: train.map((d) => +lg(d.mass).toFixed(4)), kcal: train.map((d) => +lg(d.kcal).toFixed(4)) };
exp.measured = { date: new Date().toISOString(), test: R.test.after, before: R.test.before, baseline: R.test.baselineTrainMean, split: R.split };
fs.writeFileSync('foodscan/model2.json', JSON.stringify(exp));
fs.writeFileSync('foodscan/bench-report.json', JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
log('model2.json', Math.round(fs.statSync('foodscan/model2.json').size / 1024), 'KB');
