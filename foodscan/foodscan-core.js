/* Dr. Muskel Coach – FoodScan-Kern (läuft im Browser und in Node für die Messungen)
 * Ablauf: Bild → 1 Gesamtbild + 4×4 Kacheln → Bild-Embeddings (CLIP ViT-B/32, lokal) →
 *         Vergleich mit vorberechneten Text-Embeddings (Lebensmittelklassen) →
 *         Flächenanteil je Lebensmittel → Gramm-Schätzung über kalibrierte Masse pro Tellerfläche.
 * Keine Server-Anfrage, kein Foto verlässt das Gerät.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FoodScanCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GRID = 4;
  const LOGIT = 100; // CLIP-Logit-Skala

  // Ausschnitte: zentrales Quadrat (= Tellerrahmen) + 4×4 Kacheln darin
  function crops(w, h) {
    const s = Math.min(w, h), x0 = Math.round((w - s) / 2), y0 = Math.round((h - s) / 2), t = s / GRID;
    const out = [{ x: x0, y: y0, w: s, h: s, whole: true }];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      // Kacheln leicht vergrößert (Kontext), aber im Bild halten
      const pad = t * 0.15; const x = Math.max(0, x0 + c * t - pad), y = Math.max(0, y0 + r * t - pad);
      out.push({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(w - x, t + 2 * pad)), h: Math.round(Math.min(h - y, t + 2 * pad)), r, c });
    }
    return out;
  }

  function decodeEmb(T) { // int8 + Skala → Float32 je Klasse
    if (T._f) return T._f;
    const bin = typeof atob === 'function' ? atob(T.q) : Buffer.from(T.q, 'base64').toString('binary');
    const n = T.labels.length, d = T.dim, f = new Float32Array(n * d);
    for (let i = 0; i < n * d; i++) { let v = bin.charCodeAt(i); if (v > 127) v -= 256; f[i] = v / 127; }
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < d; j++) s += f[i * d + j] ** 2; s = Math.sqrt(s) || 1; for (let j = 0; j < d; j++) f[i * d + j] /= s; }
    T._f = f; return f;
  }
  function probs(emb, T, allow) { // emb: normierter Bildvektor
    const f = decodeEmb(T), d = T.dim, n = T.labels.length, lg = new Float32Array(n); let mx = -1e9;
    for (let i = 0; i < n; i++) { if (allow && !allow[i]) { lg[i] = -1e9; continue; } let s = 0; for (let j = 0; j < d; j++) s += emb[j] * f[i * d + j]; lg[i] = s * LOGIT; if (lg[i] > mx) mx = lg[i]; }
    let z = 0; for (let i = 0; i < n; i++) { lg[i] = Math.exp(lg[i] - mx); z += lg[i]; }
    for (let i = 0; i < n; i++) lg[i] /= z; return lg;
  }
  const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, (x) => x / s); };

  /* embs: Array der Bild-Embeddings in Reihenfolge von crops(); T: Text-Embeddings; C: Kalibrierung; opt.plateCm */
  function analyze(embs, T, C, opt = {}) {
    const L = T.labels, isFood = L.map((l) => l.cat !== 'nonfood');
    const E = embs.map(norm);
    // 1. Gesamtbild: Kandidaten
    const pw = probs(E[0], T);
    const cand = L.map((l, i) => [i, pw[i]]).filter(([i]) => isFood[i]).sort((a, b) => b[1] - a[1]);
    const allow = new Array(L.length).fill(false); L.forEach((l, i) => { if (!isFood[i]) allow[i] = true; });
    cand.slice(0, C.topK || 8).forEach(([i]) => { allow[i] = true; });
    // 2. Kacheln: Kandidat je Kachel (Nicht-Lebensmittel = leer)
    const tiles = []; const area = new Map(); let foodTiles = 0;
    for (let t = 1; t < E.length; t++) {
      // jede Kachel darf zusätzlich ihr eigenes stärkstes Lebensmittel einbringen
      const own = probs(E[t], T); let bi = -1, bp = 0; for (let i = 0; i < L.length; i++) if (isFood[i] && own[i] > bp) { bp = own[i]; bi = i; }
      const al = allow.slice(); if (bi >= 0 && bp > (C.ownMin || 0.5)) al[bi] = true;
      const p = probs(E[t], T, al);
      let food = 0, best = -1, bestP = 0; for (let i = 0; i < L.length; i++) if (isFood[i]) { food += p[i]; if (p[i] > bestP) { bestP = p[i]; best = i; } }
      const isF = food >= (C.foodMin || 0.5);
      tiles.push({ label: isF ? best : -1, food: Math.round(food * 100) / 100 });
      if (isF) { foodTiles++; area.set(best, (area.get(best) || 0) + food); }
    }
    // 3. Lebensmittel, Flächenanteil, Gramm
    const nT = E.length - 1, scale = Math.pow((opt.plateCm || 26) / 26, 2);
    let items = [...area.entries()].map(([i, a]) => {
      const l = L[i], frac = a / nT, M = (C.M && C.M[l.cat]) || 300;
      return { i, k: l.k, de: l.de, en: l.en, cat: l.cat, db: l.db, frac: Math.round(frac * 1000) / 1000, grams: Math.max(5, Math.round(frac * M * (C.k || 1) * scale)), conf: Math.round(pw[i] * 100) / 100 };
    }).filter((x) => x.frac >= (C.minFrac || 0.03)).sort((a, b) => b.grams - a.grams).slice(0, 6);
    // Fallback: Kacheln unsicher, aber Gesamtbild eindeutig → Hauptlebensmittel mit Standardportion
    if (!items.length && cand.length && cand[0][1] > 0.3) {
      const l = L[cand[0][0]]; const g = (l.db && l.db.portion) || 150;
      items = [{ i: cand[0][0], k: l.k, de: l.de, en: l.en, cat: l.cat, db: l.db, frac: 0, grams: g, conf: Math.round(cand[0][1] * 100) / 100, fallback: true }];
    }
    items.forEach((x) => { const d = x.db; x.kcal = d && d.kcal != null ? Math.round(d.kcal * x.grams / 100) : null; });
    const alts = cand.slice(0, 10).map(([i, p]) => ({ k: L[i].k, de: L[i].de, p: Math.round(p * 100) / 100 }));
    return { items, alts, tiles, foodFrac: Math.round(foodTiles / nT * 100) / 100 };
  }
  return { GRID, crops, analyze, probs, decodeEmb };
});
