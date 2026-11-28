// Erkennungsgenauigkeit (Top-1/Top-3) auf Food-101-Validierungsbildern – unabhängig von Nutrition5k
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
const require = createRequire(import.meta.url); const Core = require(path.resolve('foodscan/foodscan-core.js'));
env.cacheDir = path.resolve('foodscan/models'); env.allowLocalModels = false;
const T = JSON.parse(fs.readFileSync('foodscan/text-emb.json', 'utf8')); const MAP = JSON.parse(fs.readFileSync('tools/foodscan/f101map.json', 'utf8'));
const proc = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32'); const vm = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
const L = T.labels, food = L.map((l) => l.cat !== 'nonfood'); const res = {}; let a1 = 0, a3 = 0, n = 0;
for (const cls of Object.keys(MAP)) { const dir = `/tmp/f101/${cls}`; if (!fs.existsSync(dir)) continue; let c1 = 0, c3 = 0, m = 0; const conf = {};
  for (const f of fs.readdirSync(dir)) { const img = await RawImage.read(path.join(dir, f)); const { image_embeds } = await vm(await proc(img));
    const v = Array.from(image_embeds.data); const nn = Math.sqrt(v.reduce((a, b) => a + b * b, 0)); const p = Core.probs(v.map((x) => x / nn), T, food); const top = [...p].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => L[i].k);
    const ok = MAP[cls]; if (ok.includes(top[0])) c1++; if (top.some((k) => ok.includes(k))) c3++; m++; conf[top[0]] = (conf[top[0]] || 0) + 1; }
  res[cls] = { top1: Math.round(c1 / m * 100), top3: Math.round(c3 / m * 100), n: m, oft: Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(' ') }; a1 += c1; a3 += c3; n += m; }
const out = { overallTop1: +(a1 / n * 100).toFixed(1), overallTop3: +(a3 / n * 100).toFixed(1), n, perClass: res };
fs.writeFileSync('foodscan/f101-report.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
