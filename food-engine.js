/* Dr. Muskel Coach – Ernährungs-Engine (food-engine.js)
 * Lebensmitteldatenbank, Suche, Mengen-Erkennung, Tagebuch und Coach-Wissen.
 * Wird von ernaehrung.html UND (optional) vom Voice-Coach in index.html genutzt.
 * Datenquellen: BLS 4.0 (MRI 2025), Open Food Facts (ODbL), eigene Schätz-Rezepturen.
 * Persönliche Daten bleiben lokal im Gerät (IndexedDB "dmc-food-personal").
 */
(function () {
  'use strict';
  const VERSION = '1.0.0';
  const MEALS = ['fruehstueck', 'mittag', 'abend', 'snack'];
  const MEAL_DE = { fruehstueck: 'Frühstück', mittag: 'Mittagessen', abend: 'Abendessen', snack: 'Snacks' };
  const MEAL_EN = { fruehstueck: 'Breakfast', mittag: 'Lunch', abend: 'Dinner', snack: 'Snacks' };
  const NUTR = ['kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt'];

  // ---------------- Hilfsfunktionen ----------------
  const norm = (s) => String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9,.%\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const stem = (t) => {
    if (t.length > 5 && t.endsWith('en')) return t.slice(0, -2);
    if (t.length > 4 && /[nes]$/.test(t)) return t.slice(0, -1);
    return t;
  };
  const words = (s) => norm(s).replace(/[,.%]/g, ' ').split(' ').filter(Boolean);
  const today = () => dateKey(new Date());
  function dateKey(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
  function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n); return dateKey(dt); }
  const round = (v, d = 0) => (v == null || isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
  const fmt = (v, d = 0) => v == null ? '–' : Number(round(v, d)).toLocaleString(api.lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: d });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // ---------------- IndexedDB ----------------
  function openDB(name, stores) {
    return new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [s, opt] of Object.entries(stores)) {
          if (!db.objectStoreNames.contains(s)) {
            const os = db.createObjectStore(s, opt.keyPath ? { keyPath: opt.keyPath } : undefined);
            (opt.idx || []).forEach((i) => os.createIndex(i, i));
          }
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(db, store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode); const os = t.objectStore(store);
      let out; const r = fn(os);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  let pubDB, perDB;
  const kvGet = async (k, d) => { const v = await tx(perDB, 'kv', 'readonly', (s) => s.get(k)); return v === undefined ? d : v; };
  const kvSet = (k, v) => tx(perDB, 'kv', 'readwrite', (s) => s.put(v, k));

  // ---------------- Datenbestand ----------------
  const foods = []; const byId = new Map(); const byEan = new Map();
  const vocab = new Map(); // Suchindex: Token -> Lebensmittel[]
  let catNames = {};
  const sources = {};

  function indexFood(f) {
    const nameTok = words(f.n);
    const extra = words([f.brand, f.alias, f.store].filter(Boolean).join(' '));
    const toks = new Set();
    const add = (t) => { if (t.length > 1) { toks.add(t); toks.add(stem(t)); } };
    nameTok.forEach(add); extra.forEach(add);
    for (let i = 0; i < nameTok.length - 1; i++) { toks.add(nameTok[i] + nameTok[i + 1]); if (i < nameTok.length - 2) toks.add(nameTok[i] + nameTok[i + 1] + nameTok[i + 2]); }
    f._t = [...toks]; f._n = nameTok.filter((t) => /[a-z]/.test(t)).length; f._first = nameTok[0] || '';
    f._b = f.brand ? words(f.brand) : [];
    f._state = STATE_RE.test(' ' + nameTok.join(' ') + ' ');
    f._t.forEach((t) => { const a = vocab.get(t); if (a) a.push(f); else vocab.set(t, [f]); });
    tsCache.clear();
    if (byId.has(f.id)) { const i = foods.indexOf(byId.get(f.id)); if (i >= 0) foods.splice(i, 1); }
    foods.push(f); byId.set(f.id, f);
    if (f.ean) byEan.set(String(f.ean), f);
  }
  const STATE_WORDS = ['roh', 'gekocht', 'gebraten', 'gegrillt', 'frittiert', 'gebacken', 'getrocknet', 'tiefgefroren', 'konserve', 'geraeuchert', 'geduenstet', 'geschmort', 'pochiert', 'gargezogen'];
  const STATE_RE = new RegExp(' (' + STATE_WORDS.join('|') + ') ');

  function loadBLS(d) {
    catNames = Object.assign({}, d.meta.cats || {});
    sources.bls = d.meta;
    const c = d.cols;
    for (const r of d.rows) {
      const f = { src: 'bls', q: 'ref', unit: 'g' };
      c.forEach((k, i) => { f[k] = r[i]; });
      f.id = 'bls:' + f.id;
      if (f.cat === 'N' || f.cat === 'P') f.unit = 'ml';
      indexFood(f);
    }
  }
  function loadEst(d) {
    sources.est = d.meta;
    for (const r of d.rows) indexFood(Object.assign({ src: 'est', q: 'est', unit: 'g' }, r));
  }
  function loadOFF(d) {
    sources.off = d.meta;
    const c = d.cols;
    for (const r of d.rows) {
      const f = { src: 'off', q: 'mfr' };
      c.forEach((k, i) => { f[k] = r[i]; });
      f.id = 'off:' + f.ean; f.unit = f.unit || 'g';
      if (f.pg) f.portion = { g: f.pg, label: f.pl || '1 Portion' };
      f.allergens = f.all || null; f.updated = f.upd || null; f.license = 'ODbL – © Open Food Facts contributors';
      if (!f.cat) f.cat = 'O';
      indexFood(f);
    }
  }

  async function cachedFetch(file, loader, optional) {
    const key = 'file:' + file;
    let cached;
    try { cached = await tx(pubDB, 'files', 'readonly', (s) => s.get(key)); } catch (e) { /* ignore */ }
    if (cached) loader(cached.data);
    const refresh = (async () => {
      try {
        const r = await fetch(api.base + file, { cache: 'no-cache' });
        if (!r.ok) { if (!optional) throw new Error(file + ' ' + r.status); return false; }
        const data = await r.json();
        if (!cached || JSON.stringify(cached.data.meta) !== JSON.stringify(data.meta)) {
          await tx(pubDB, 'files', 'readwrite', (s) => s.put({ data, t: Date.now() }, key));
          if (!cached) loader(data); else api._needsReload = true;
        }
        return true;
      } catch (e) { if (!cached && !optional) throw e; return false; }
    })();
    if (!cached) await refresh;
    return !!cached || refresh;
  }

  let initP = null;
  async function init(opts = {}) {
    if (initP) return initP;
    api.base = opts.base || api.base;
    initP = (async () => {
      pubDB = await openDB('dmc-food-public', { files: {}, offcache: { keyPath: 'id' } });
      perDB = await openDB('dmc-food-personal', { entries: { keyPath: 'id', idx: ['date'] }, custom: { keyPath: 'id' }, kv: {} });
      api.lang = opts.lang || (await kvGet('lang', null)) || detectLang();
      await cachedFetch('lebensmittel-bls.json', loadBLS);
      await cachedFetch('gerichte-schaetzwerte.json', loadEst, true);
      await cachedFetch('off-de.json', loadOFF, true);
      (await tx(pubDB, 'offcache', 'readonly', (s) => s.getAll()) || []).forEach(indexFood);
      (await tx(perDB, 'custom', 'readonly', (s) => s.getAll()) || []).forEach(indexFood);
      usage = await kvGet('usage', {});
      favs = new Set(await kvGet('favs', []));
      api.ready = true;
      return api;
    })();
    return initP;
  }
  function detectLang() {
    try {
      const ml = localStorage.getItem('mc_lang'); if (ml === 'de' || ml === 'en') return ml;
      for (const k of ['lang', 'language', 'dmc_lang', 'appLang', 'sprache']) { const v = localStorage.getItem(k); if (v && /^(de|en)/i.test(v.replace(/"/g, ''))) return v.replace(/"/g, '').slice(0, 2).toLowerCase(); }
    } catch (e) { /* ignore */ }
    return 'de';
  }

  // ---------------- Suche ----------------
  const SYN = [
    [/\b(haehnchen|huehner|chicken|gefluegel) ?doener\b|\bdoener (mit )?(haehnchen|chicken|gefluegel|pute)\b/g, 'doener kebab gefluegel'],
    [/\b(kalbs?|rinder?) ?doener\b|\bdoener (mit )?(kalb|rind)(fleisch)?\b/g, 'doener kebab kalb'],
    [/\b(vegetarischer|veggie|vegi) doener\b/g, 'doener vegetarisch'],
    [/\bdoener\b(?! ?(kebab|box|teller|vegetarisch|sauce|sosse|fleisch))/g, 'doener kebab'],
    [/\b(brokkoli|brokoli|brocoli|broccoli)\b/g, 'broccoli'],
    [/\b(fettarme|fettarm) milch\b|\bmilch (1[.,]5|fettarm)\b/g, 'milch fettarm frisch'],
    [/^(glas |ein glas )?milch$/g, 'vollmilch frisch'],
    [/^bier$|\bpils\b/g, 'pilsner bier'],
    [/\b(basmati|jasmin|langkorn|weisser) ?reis\b|\bbasmati\b/g, 'reis poliert'],
    [/\b(vollkorn|natur|brauner) ?reis\b/g, 'reis unpoliert'],
    [/\bvollkorn ?(spaghetti|nudeln|pasta|penne|fusilli)\b/g, 'vollkornteigwaren eifrei'],
    [/\b(bandnudeln|tagliatelle|eiernudeln|spaetzle)\b/g, 'eierteigwaren'],
    [/\b(spaghetti|penne|fusilli|makkaroni|maccaroni|rigatoni|farfalle|pasta|nudeln|nudel)\b/g, 'teigwaren eifrei'],
    [/\bsuesskartoffel ?(pommes|fritten)\b/g, 'suesskartoffel frittiert'],
    [/\b(pommes|fritten)\b(?! frites)/g, 'pommes frites'],
    [/\b(cola|coke) ?(zero|light)\b|\bzero cola\b|\bcoca cola zero\b/g, 'colagetraenk koffeinhaltig suessungsmitteln'],
    [/\b(coca cola|cola|coke)\b/g, 'colagetraenk koffeinhaltig'],
    [/\b(ei|eier)\b/g, 'huehnerei'],
    [/\bputen ?brust\b/g, 'pute brust'],
    [/\b(haehnchen|huehner|chicken) ?brust(filet)?s?\b/g, 'haehnchen brustfilet'],
    [/\b(haehnchen|huehner) ?schenkel\b/g, 'haehnchen oberschenkel'],
    [/\b(chicken )?wings?\b|\bhaehnchen ?fluegel\b/g, 'haehnchen fluegel'],
    [/\brinder ?hack(fleisch)?\b/g, 'rind hackfleisch'],
    [/\b(gemischtes hack(fleisch)?|hack(fleisch)? gemischt)\b/g, 'hackfleisch gemischt'],
    [/\b(steak|rindersteak|rumpsteak)\b/g, 'rinderrumpsteak'],
    [/\b(sosse|sossen)\b/g, 'sauce'],
    [/\b(dose|dosen)\b/g, 'konserve'],
    [/^(tee|schwarzer tee|schwarztee)$/g, 'schwarztee getraenk'],
    [/^(gruener tee|gruentee)$/g, 'gruentee getraenk'],
    [/\b(semmel|schrippe|weckle|weck)\b/g, 'weizenbroetchen'],
    [/\b(bulette|boulette|fleischpflanzerl|fleischkuechle)\b/g, 'frikadelle'],
    [/\b(mineralwasser|sprudel|sprudelwasser)\b/g, 'mineralwasser kohlensaeure'],
    [/\bstilles wasser\b/g, 'mineralwasser still'],
    [/\b(griechischer joghurt)\b/g, 'sahnejoghurt'],
    [/\b(huettenkaese|cottage cheese)\b/g, 'koerniger frischkaese'],
    [/\b(schafskaese)\b/g, 'feta'],
    [/\b(gummibaerchen|gummibaeren)\b/g, 'fruchtgummi'],
    [/\b(paprika)\b(?! ?(pulver|gewuerz))/g, 'gemuesepaprika'],
    [/\bmoehren?\b|\bkarotten?\b/g, 'karotte'],
    [/\bwein\b/g, 'rotwein'],
  ];
  function expandQuery(q) { let n = norm(q); for (const [re, rep] of SYN) n = n.replace(re, rep); return n.trim(); }

  const STOP = new Set(['mit', 'und', 'von', 'vom', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'einer', 'zum', 'zur', 'im', 'in', 'am', 'auf', 'aus', 'fuer', 'stueck', 'portion', 'the', 'a', 'of', 'oder']);

  const tsCache = new Map();
  function tokenScores(q) {
    if (tsCache.has(q)) return tsCache.get(q);
    const qs = stem(q); const m = new Map(); let strong = 0;
    for (const t of vocab.keys()) { // 1. schnell: exakt, Wortanfang, enthalten
      let s = 0;
      if (t === q || t === qs) s = 3;
      else if (qs.length >= 3 && t.startsWith(qs)) s = 2.2 - Math.min(0.6, (t.length - qs.length) * 0.04);
      else if (qs.length >= 5 && t.includes(qs)) s = 1.5;
      if (s) { m.set(t, s); if (s >= 2) strong++; }
    }
    if (!strong && q.length >= 4) { // 2. nur ohne Treffer: Tippfehler-Toleranz
      const maxD = q.length >= 7 ? 2 : 1;
      for (const t of vocab.keys()) {
        if (m.has(t)) continue;
        if (Math.abs(t.length - q.length) <= maxD && lev(q, t, maxD) <= maxD) m.set(t, 1.2);
        else if (q.length >= 5 && t.length > q.length && t[0] === q[0] && lev(q, t.slice(0, q.length), 1) <= 1) m.set(t, 1.0);
      }
    }
    if (tsCache.size > 300) tsCache.clear();
    tsCache.set(q, m); return m;
  }

  let usage = {}; let favs = new Set();
  function search(query, opt = {}) {
    if (!query || !query.trim()) return [];
    const expanded = expandQuery(query);
    const qt = expanded.replace(/[,.%]/g, ' ').split(' ').filter((t) => t && !STOP.has(t));
    if (!qt.length) return [];
    const maps = qt.map(tokenScores);
    const hasState = qt.some((t) => STATE_WORDS.includes(t) || STATE_WORDS.includes(stem(t)));
    // pro Suchwort: beste Trefferstärke je Lebensmittel (über den Index, statt alle Lebensmittel zu prüfen)
    const per = maps.map((m) => { const fm = new Map(); for (const [t, sc] of m) { const arr = vocab.get(t); if (!arr) continue; for (const f of arr) { const c = fm.get(f); if (!c || sc > c.s) fm.set(f, { s: sc, t }); } } return fm; });
    const allowMiss = qt.length >= 3 ? 1 : 0;
    const poolSet = opt.pool ? new Set(opt.pool.map((f) => f.id)) : null;
    const cand = new Set(); per.forEach((fm) => fm.forEach((_, f) => cand.add(f)));
    const res = [];
    for (const f of cand) {
      if (byId.get(f.id) !== f) continue;
      if (poolSet && !poolSet.has(f.id)) continue;
      if (opt.src && f.src !== opt.src) continue;
      let sum = 0; let miss = 0; let firstHit = 0;
      for (let i = 0; i < per.length; i++) {
        const h = per[i].get(f);
        if (!h) { miss++; continue; }
        sum += h.s;
        if (i === 0 && f._first && (h.t.startsWith(f._first) || h.t === stem(f._first))) firstHit = 0.6;
      }
      if (miss > allowMiss) continue;
      let score = sum + firstHit - 0.07 * f._n;
      if (!hasState) {
        if (/ roh\b/.test(' ' + f._t.join(' '))) score += 0.3;
        if (f._t.some((t) => /^(tiefgefroren|getrocknet|konserve|pulver|mariniert|trockenprodukt|instantpulver|beikost)$/.test(t))) score -= 0.5;
      }
      if (f.src === 'user' || f.src === 'recipe') score += 0.4;
      if (f.src === 'est') score += 0.2;
      if (f.src === 'off') score -= f._b.some((b) => qt.some((q) => b.startsWith(stem(q)))) ? 0 : 1.0;
      if (f.cat === 'X' || f.cat === 'Y') score -= 0.25;
      const u = usage[f.id]; if (u) score += Math.min(1, 0.2 * Math.log2(1 + u));
      res.push({ f, s: score });
    }
    res.sort((a, b) => b.s - a.s);
    return res.slice(0, opt.limit || 30).map((r) => r.f);
  }

  // ---------------- Portionen (Schätzwerte, klar gekennzeichnet) ----------------
  // [Regex auf normalisierten Namen, Portionen in g/ml]
  const PORTIONS = [
    [/^doener kebab|^doener vegetarisch/, { stk: [350, '1 Döner'] }],
    [/^tuerkische pizza/, { stk: [250, '1 Lahmacun'] }],
    [/^falafel \(/, { stk: [25, '1 Falafel'], portion: [150, '6 Falafel'] }],
    [/^falafel frittiert, in fladenbrot/, { stk: [350, '1 Falafel-Tasche'] }],
    [/^pizza|^vollkornpizza/, { stk: [380, '1 ganze Pizza'], scheibe: [50, '1 Stück (⅛)'] }],
    [/^currywurst mit pommes/, { portion: [350, '1 Portion'] }],
    [/^currywurst/, { portion: [200, '1 Portion'] }],
    [/^pommes frites/, { klein: [100, 'klein'], mittel: [150, 'mittel'], gross: [200, 'groß'], portion: [150, '1 Portion (mittel)'] }],
    [/^gyros \(/, { portion: [200, '1 Portion'] }],
    [/^sushi/, { stk: [30, '1 Sushi-Stück'], portion: [240, '8 Stück'] }],
    [/^fruehlingsrolle/, { stk: [60, '1 Frühlingsrolle'] }],
    [/^chickenburger|^gyrosburger|^tofu burger/, { stk: [180, '1 Burger'] }],
    [/^wrap|^burrito/, { stk: [280, '1 Stück'] }],
    [/^huehnerei|^spiegelei|^ruehrei/, { stk: [55, '1 Ei (Gr. M, ohne Schale)'] }],
    [/^banane/, { stk: [120, '1 Banane (geschält)'] }],
    [/^apfel /, { stk: [150, '1 Apfel (mittel)'] }],
    [/^birne/, { stk: [160, '1 Birne'] }],
    [/^orange|^apfelsine/, { stk: [150, '1 Orange (geschält)'] }],
    [/^mandarine|^clementine/, { stk: [60, '1 Mandarine'] }],
    [/^kiwi/, { stk: [75, '1 Kiwi'] }],
    [/^(pfirsich|nektarine)/, { stk: [130, '1 Stück'] }],
    [/^avocado/, { stk: [140, '1 Avocado (Fruchtfleisch)'] }],
    [/^(erdbeere|himbeere|heidelbeere|brombeere|weintraube)/, { portion: [125, '1 Schale'], handvoll: [80, '1 Handvoll'] }],
    [/^dattel/, { stk: [8, '1 Dattel'] }],
    [/^tomate roh/, { stk: [80, '1 Tomate'] }],
    [/^gurke roh/, { stk: [400, '1 Salatgurke'] }],
    [/^gemuesepaprika/, { stk: [150, '1 Paprika'] }],
    [/^karotte/, { stk: [70, '1 Karotte'] }],
    [/^speisezwiebel/, { stk: [60, '1 Zwiebel'] }],
    [/^kartoffel (geschaelt|ungeschaelt)/, { stk: [80, '1 Kartoffel (mittel)'], portion: [250, '1 Portion'] }],
    [/^(mandel|walnuss|haselnuss|cashew|pistazie|erdnuss geroestet|paranuss|macadamia|pekannuss|studentenfutter|kuerbiskern|sonnenblumenkern)/, { handvoll: [30, '1 Handvoll'], portion: [30, '1 Handvoll'] }],
    [/^(chiasamen|leinsamen|sesam)/, { el: [10, '1 EL'], portion: [15, '1 Portion'] }],
    [/^(erdnussbutter|erdnussmus|mandelmus|nussmus|nuss nougat)/, { el: [15, '1 EL'], tl: [7, '1 TL'], portion: [15, '1 EL'] }],
    [/^\w*broetchen/, { stk: [60, '1 Brötchen'] }],
    [/^laugenbrezel/, { stk: [80, '1 Brezel'] }],
    [/toastbrot/, { scheibe: [28, '1 Scheibe Toast'] }],
    [/^\w*brot\b/, { scheibe: [50, '1 Scheibe Brot'] }, 'B'],
    [/^croissant/, { stk: [60, '1 Croissant'] }],
    [/^(berliner|krapfen|donut|doughnut)/, { stk: [70, '1 Stück'] }],
    [/kuchen|torte/, { stk: [100, '1 Stück Kuchen'] }, 'D'],
    [/kekse|plaetzchen/, { stk: [10, '1 Keks'] }, 'D'],
    [/^weizenfladenbrot/, { stk: [250, '1 Fladenbrot'] }],
    [/^weizentortilla/, { stk: [60, '1 Tortilla/Wrap-Fladen'] }],
    [/^(gouda|edamer|emmentaler|tilsiter|butterkaese|chester|bergkaese|leerdammer)/, { scheibe: [25, '1 Scheibe Käse'] }],
    [/^mozzarella/, { stk: [125, '1 Kugel'] }],
    [/^(skyr)/, { becher: [450, '1 Becher (450 g)'], portion: [150, '1 Portion'] }],
    [/^speisequark|^magerquark/, { becher: [250, '1 Becher (250 g)'], portion: [125, '1 Portion'] }],
    [/^koerniger frischkaese/, { becher: [200, '1 Becher (200 g)'] }],
    [/^\w*joghurt/, { becher: [150, '1 Becher (150 g)'] }, 'MH'],
    [/^(butter|halbfettbutter|pflanzliches streichfett|margarine)/, { portion: [10, '1 Portion (10 g)'], tl: [5, '1 TL'], el: [12, '1 EL'] }],
    [/oel\b/, { el: [10, '1 EL'], tl: [4, '1 TL'], portion: [10, '1 EL'] }, 'Q'],
    [/^honig|konfituere|marmelade/, { tl: [8, '1 TL'], el: [20, '1 EL'], portion: [20, '1 EL'] }],
    [/^(zucker|haushaltszucker)/, { tl: [4, '1 TL'], el: [12, '1 EL'] }],
    [/ketchup|mayonnaise|senf|sauce|sosse|dressing/, { el: [15, '1 EL'], portion: [20, '1 Portion'] }, 'QRX'],
    [/^(schwein kochschinken|putenbrust, koch|kochschinken|lachsschinken|schinken)/, { scheibe: [20, '1 Scheibe'] }],
    [/salami/, { scheibe: [7, '1 Scheibe'] }, 'W'],
    [/bratwurst|wiener|bockwurst|knacker/, { stk: [100, '1 Wurst'] }, 'WH'],
    [/^hot dog/, { stk: [130, '1 Hot Dog'] }],
    [/^frikadelle/, { stk: [100, '1 Frikadelle'] }],
    [/schnitzel.*(paniert|gebraten)|wiener schnitzel/, { stk: [160, '1 Schnitzel'] }],
    [/^haehnchen brust|^haehnchen brustfilet|^pute brust/, { stk: [150, '1 Filet'] }],
    [/^lachs (roh|gebraten|gegrillt|pochiert)/, { stk: [125, '1 Filet'] }],
    [/^thunfisch .*konserve/, { dose: [150, '1 Dose (abgetropft)'], portion: [150, '1 Dose (abgetropft)'] }],
    [/^speisequark|^magerquark/, { becher: [250, '1 Becher (250 g)'], portion: [125, '1 Portion'] }],
    [/^fischstaebchen/, { stk: [30, '1 Fischstäbchen'] }],
    [/^reis .*gekocht|^wildreis gekocht|^quinoa .*gekocht|^bulgur .*gekocht|^couscous .*gekocht/, { portion: [200, '1 Portion (gekocht)'] }],
    [/^reis .*roh|^wildreis roh|^quinoa .*roh|^bulgur|^couscous/, { portion: [70, '1 Portion (roh)'] }],
    [/teigwaren.*gekocht/, { portion: [250, '1 Portion (gekocht)'] }],
    [/teigwaren.*(roh|getrocknet)$|teigwaren eifrei, roh|teigwaren roh/, { portion: [100, '1 Portion (roh)'] }],
    [/^hafer flocken|haferflocken/, { portion: [50, '1 Portion'], el: [10, '1 EL'] }],
    [/muesli/, { portion: [60, '1 Portion'] }],
    [/^cornflakes/, { portion: [30, '1 Portion'] }],
    [/^speiseeis/, { kugel: [60, '1 Kugel'], portion: [120, '2 Kugeln'] }],
    [/schokolade/, { stk: [6, '1 Stück/Rippe'], portion: [25, '¼ Tafel'] }, 'S'],
    [/^fruchtgummi/, { handvoll: [25, '1 Handvoll'], portion: [25, '1 Handvoll'] }],
    [/^kartoffelchips/, { handvoll: [25, '1 Handvoll'], portion: [30, '1 Portion'] }],
    [/^(espresso)/, { tasse: [30, '1 Espresso'], portion: [30, '1 Espresso'] }],
    [/^(cappuccino)/, { tasse: [200, '1 Tasse'], portion: [200, '1 Tasse'] }],
    [/^latte macchiato/, { glas: [300, '1 Glas'], portion: [300, '1 Glas'] }],
    [/^kaffee|tee \(getraenk|^tee\b/, { tasse: [150, '1 Tasse'], becher: [250, '1 Becher'], portion: [200, '1 Tasse'] }],
    [/^(cola|\w*limonade|eistee|colagetraenk)/, { dose: [330, '1 Dose (330 ml)'], flasche: [500, '1 Flasche (0,5 l)'], glas: [250, '1 Glas'], klein: [250, 'klein (0,25 l)'], mittel: [400, 'mittel (0,4 l)'], gross: [500, 'groß (0,5 l)'], portion: [330, '1 Dose'] }],
    [/bier\b|radler/, { flasche: [500, '1 Flasche (0,5 l)'], glas: [300, '1 Glas (0,3 l)'], dose: [500, '1 Dose (0,5 l)'], portion: [500, '0,5 l'] }, 'P'],
    [/wein|sekt/, { glas: [150, '1 Glas (0,15 l)'], flasche: [750, '1 Flasche'], portion: [150, '1 Glas'] }, 'P'],
    [/saft|nektar|schorle|smoothie/, { glas: [200, '1 Glas'], flasche: [500, '1 Flasche'], portion: [200, '1 Glas'] }, 'FNP'],
    [/^(h )?\w*milch\b|drink|^ayran|^kefir|milchshake|kakao/, { glas: [200, '1 Glas'], tasse: [150, '1 Tasse'], portion: [200, '1 Glas'] }, 'MNH'],
    [/wasser/, { glas: [250, '1 Glas'], flasche: [500, '1 Flasche (0,5 l)'], portion: [250, '1 Glas'] }, 'N'],
    [/suppe|eintopf/, { teller: [300, '1 Teller'], portion: [300, '1 Teller'] }, 'XY'],
  ];
  const CAT_DEFAULT = { F: 125, G: 150, N: 250, P: 250, X: 350, Y: 350, Z: 300, B: 50, D: 80, M: 150, S: 30, Q: 10, R: 15, T: 150, U: 150, V: 150, W: 30, C: 60, E: 60, H: 30, K: 200, O: 100 };

  function portionsFor(f) {
    const out = [];
    if (f.portion && f.portion.g) out.push({ key: 'portion', g: f.portion.g, label: f.portion.label || '1 Portion', est: f.src !== 'off' && f.src !== 'user' && f.src !== 'recipe' });
    const n = norm(f.n);
    for (const [re, p, cats] of PORTIONS) {
      if ((!cats || cats.includes(f.cat)) && re.test(n)) {
        for (const [k, [g, label]] of Object.entries(p)) if (!out.some((o) => o.key === k)) out.push({ key: k, g, label, est: true });
        break;
      }
    }
    if (!out.length) out.push({ key: 'portion', g: CAT_DEFAULT[f.cat] || 100, label: '1 Portion (Vorschlag)', est: true });
    return out;
  }
  const defaultPortion = (f) => { const p = portionsFor(f); return p.find((x) => x.key === 'portion') || p.find((x) => x.key === 'stk') || p[0]; };

  function nutrients(f, grams) {
    const o = {}; const k = grams / 100;
    NUTR.forEach((n) => { o[n] = f[n] == null ? null : f[n] * k; });
    if (o.kcal == null && o.kj != null) o.kcal = o.kj / 4.184;
    return o;
  }

  // ---------------- Spracheingabe / Mahlzeiten-Erkennung ----------------
  const NUMW = { ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, fuenfzehn: 15, zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, hundert: 100, halb: 0.5, halbe: 0.5, halben: 0.5, halbes: 0.5, anderthalb: 1.5, eineinhalb: 1.5, paar: 3, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
  const UNIT_RE = '(kg|kilo|kilogramm|g|gr|gramm|grams?|ml|milliliter|cl|l|liter|litre|stueck|stk|scheiben?|el|essloeffel|tl|teeloeffel|portionen?|glaeser|glas|tassen?|becher|dosen?|flaschen?|handvoll|kugeln?|riegel|teller|schalen?|packung(?:en)?|tueten?|slices?|cups?|pieces?)';
  const NUM_RE = '(\\d+(?:[.,]\\d+)?|' + Object.keys(NUMW).join('|') + ')';
  const AMOUNT = new RegExp('(?:^|\\s)' + NUM_RE + '\\s*' + UNIT_RE + '?(?=\\s|$)');
  const UNIT_ONLY = new RegExp('(?:^|\\s)' + UNIT_RE + '(?=\\s|$)');
  const SIZE_RE = /\b(klein|kleine|kleinen|kleiner|kleines|mittel|mittlere|mittleren|mittlerer|mittleres|gross|grosse|grossen|grosser|grosses|small|medium|large)\b/;
  const FILLER = /\b(ich|hab|habe|hatte|heute|gerade|eben|gestern|morgen|abends|mittags|morgens|gegessen|getrunken|essen|trinken|trage|tragen|trag|eintragen|ein ?getragen|notiere|notier|speicher|speichere|bitte|mal|noch|dazu|ausserdem|zusaetzlich|auch|so|etwa|ungefaehr|circa|ca|zum|zur|fuer|als|frueh?stueck|fruehstueck|mittagessen|mittag|abendessen|abendbrot|abend|snack|zwischendurch|nachmittag|vormittag|i|had|ate|drank|for|breakfast|lunch|dinner|today)\b/g;

  function detectMeal(n) {
    if (/fruehstueck|breakfast|morgens/.test(n)) return 'fruehstueck';
    if (/mittag|lunch/.test(n)) return 'mittag';
    if (/abend|dinner/.test(n)) return 'abend';
    if (/snack|zwischendurch|nachmittag/.test(n)) return 'snack';
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    return h < 10.5 ? 'fruehstueck' : h < 15 ? 'mittag' : h < 17.5 ? 'snack' : 'abend';
  }

  function unitKey(u) {
    if (!u) return null;
    if (/^(kg|kilo|kilogramm)$/.test(u)) return 'kg';
    if (/^(g|gr|gramm|grams?)$/.test(u)) return 'g';
    if (/^(ml|milliliter)$/.test(u)) return 'ml';
    if (u === 'cl') return 'cl';
    if (/^(l|liter|litre)$/.test(u)) return 'l';
    if (/^(stueck|stk|pieces?)$/.test(u)) return 'stk';
    if (/^(scheiben?|slices?)$/.test(u)) return 'scheibe';
    if (/^(el|essloeffel)$/.test(u)) return 'el';
    if (/^(tl|teeloeffel)$/.test(u)) return 'tl';
    if (/^portion/.test(u)) return 'portion';
    if (/^(glas|glaeser)$/.test(u)) return 'glas';
    if (/^(tassen?|cups?)$/.test(u)) return 'tasse';
    if (u === 'becher') return 'becher';
    if (/^dosen?$/.test(u)) return 'dose';
    if (/^flaschen?$/.test(u)) return 'flasche';
    if (u === 'handvoll') return 'handvoll';
    if (/^kugeln?$/.test(u)) return 'kugel';
    if (u === 'riegel') return 'riegel';
    if (u === 'teller') return 'teller';
    if (/^schalen?$/.test(u)) return 'schale';
    if (/^(packung|tuete)/.test(u)) return 'packung';
    return null;
  }
  const GENERIC_UNIT = { scheibe: 25, el: 15, tl: 5, glas: 200, tasse: 150, becher: 150, dose: 330, flasche: 500, handvoll: 30, kugel: 60, riegel: 50, teller: 300, schale: 150 };

  function amountFor(f, qty, uk, size) {
    const ps = portionsFor(f); const get = (k) => ps.find((p) => p.key === k);
    const q = qty == null ? 1 : qty;
    if (uk === 'g') return { grams: q, label: fmt(q) + (f.unit === 'ml' ? ' g' : ' g'), est: false };
    if (uk === 'kg') return { grams: q * 1000, label: fmt(q, 2) + ' kg', est: false };
    if (uk === 'ml') return { grams: q, label: fmt(q) + ' ml', est: false };
    if (uk === 'l') return { grams: q * 1000, label: fmt(q, 2) + ' l', est: false };
    if (uk === 'cl') return { grams: q * 10, label: fmt(q) + ' cl', est: false };
    if (size) {
      const sk = /^(klein|small)/.test(size) ? 'klein' : /^(mittl|mittel|medium)/.test(size) ? 'mittel' : 'gross';
      const p = get(sk);
      if (p) return { grams: q * p.g, label: (q !== 1 ? fmt(q, 1) + '× ' : '') + p.label, est: true };
      const d = defaultPortion(f); const fac = sk === 'klein' ? 0.75 : sk === 'mittel' ? 1 : 1.35;
      return { grams: q * d.g * fac, label: (q !== 1 ? fmt(q, 1) + '× ' : '') + sk + ' (' + d.label + ')', est: true };
    }
    if (uk && uk !== 'stk' && uk !== 'portion') {
      const p = get(uk);
      if (p) return { grams: q * p.g, label: fmt(q, 1) + '× ' + p.label, est: true };
      if (uk === 'packung') { const d = defaultPortion(f); return { grams: q * d.g, label: fmt(q, 1) + '× Packung → bitte Menge prüfen', est: true, unsure: true }; }
      return { grams: q * GENERIC_UNIT[uk], label: fmt(q, 1) + '× ' + uk + ' (≈' + GENERIC_UNIT[uk] + ' g)', est: true };
    }
    const p = (uk === 'portion' ? get('portion') : null) || get('stk') || defaultPortion(f);
    const unsure = qty == null && /Vorschlag/.test(p.label);
    return { grams: q * p.g, label: (q !== 1 ? fmt(q, 1) + '× ' : '') + p.label, est: true, unsure };
  }

  function parseMeal(text) {
    let n = ' ' + norm(text) + ' ';
    const meal = detectMeal(n);
    n = n.replace(/(\d)\s*,\s*(\d)/g, '$1.$2');
    const segs = n.split(/,|;|\bund\b|\bsowie\b|\bplus\b|\bdazu\b|\bdanach\b|\bdann\b|\bausserdem\b|\band\b/).map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (let seg of segs) {
      seg = ' ' + seg + ' ';
      let qty = null; let uk = null; let size = null;
      const m = seg.match(AMOUNT);
      if (m) {
        const raw = m[1]; qty = NUMW[raw] != null ? NUMW[raw] : parseFloat(raw.replace(',', '.'));
        uk = unitKey(m[2]);
        const isArticle = NUMW[raw] === 1 && !m[2] && /^(ein|eine|einen|einem|einer|a|an)$/.test(raw);
        seg = seg.replace(m[0], ' ');
        if (isArticle) qty = 1;
      } else {
        const u = seg.match(UNIT_ONLY); if (u) { uk = unitKey(u[1]); seg = seg.replace(u[0], ' '); qty = 1; }
      }
      const s = seg.match(SIZE_RE); if (s) { size = s[1]; seg = seg.replace(SIZE_RE, ' '); }
      seg = seg.replace(FILLER, ' ').replace(/\b(von|vom|mit dem|mit der)\b(?=\s)/, ' ').replace(/\s+/g, ' ').trim();
      seg = seg.replace(/[.,!?]+/g, ' ').replace(/\s+ein\s*$/, '').replace(/\s+/g, ' ').trim();
      seg = seg.replace(/^(der|die|das|den|dem|ein|eine|einen|einem|einer|mit)\s+/, '').trim();
      if (!seg || seg.length < 2) continue;
      if (/^(wasser|leitungswasser|trinkwasser)$/.test(seg)) {
        const a = uk ? amountFor({ n: 'wasser', cat: 'N', unit: 'ml' }, qty, uk, size) : { grams: (qty || 1) * 250 };
        items.push({ water: true, query: seg, grams: a.grams });
        continue;
      }
      const found = search(seg, { limit: 8 });
      const item = { query: seg, qty, unit: uk, size, alts: found, food: found[0] || null, flags: [] };
      if (item.food) {
        Object.assign(item, amountFor(item.food, qty, uk, size));
        if (item.unsure) item.flags.push('menge');
        const st = STATE_WORDS.some((w) => (' ' + seg + ' ').includes(' ' + w));
        if (!st && found.slice(0, 6).some((f) => / roh\b/.test(norm(f.n))) && found.slice(0, 6).some((f) => /gekocht/.test(norm(f.n)))) item.flags.push('rohgekocht');
        if (item.food.q === 'est') item.flags.push('schaetzwert');
        if (/^(reis poliert|teigwaren eifrei)/.test(expandQuery(seg)) && /basmati|jasmin|spaghetti|penne|fusilli|nudel|pasta/.test(seg)) item.flags.push('generisch');
      } else { item.grams = qty && (uk === 'g' || uk === 'ml') ? qty : null; item.flags.push('nichtgefunden'); }
      items.push(item);
    }
    return { meal, items, date: /gestern/.test(n) ? addDays(today(), -1) : today() };
  }

  // ---------------- Tagebuch ----------------
  function snapshot(f) { const o = {}; NUTR.forEach((k) => { o[k] = f[k] == null ? null : f[k]; }); return o; }
  async function addEntry({ food, grams, meal, date, label }) {
    const e = { id: uid(), date: date || today(), meal: meal || detectMeal(''), fid: food.id, name: food.n, en: food.en || null, brand: food.brand || null, grams: Math.round(grams), unit: food.unit || 'g', src: food.src, q: food.q, label: label || null, n100: snapshot(food), ts: Date.now() };
    await tx(perDB, 'entries', 'readwrite', (s) => s.put(e));
    usage[food.id] = (usage[food.id] || 0) + 1; await kvSet('usage', usage);
    const rec = (await kvGet('recent', [])).filter((id) => id !== food.id); rec.unshift(food.id); await kvSet('recent', rec.slice(0, 40));
    if (!byId.has(food.id) && (food.src === 'off')) await cacheOFF(food);
    return e;
  }
  const updateEntry = (e) => tx(perDB, 'entries', 'readwrite', (s) => s.put(e));
  const removeEntry = (id) => tx(perDB, 'entries', 'readwrite', (s) => s.delete(id));
  const getDay = (date) => tx(perDB, 'entries', 'readonly', (s) => s.index('date').getAll(IDBKeyRange.only(date || today())));
  const getRange = (from, to) => tx(perDB, 'entries', 'readonly', (s) => s.index('date').getAll(IDBKeyRange.bound(from, to)));
  const entryNutr = (e) => { const o = {}; NUTR.forEach((k) => { o[k] = e.n100[k] == null ? null : e.n100[k] * e.grams / 100; }); if (o.kcal == null && o.kj != null) o.kcal = o.kj / 4.184; return o; };
  function sumEntries(list) {
    const t = { kcal: 0, p: 0, c: 0, f: 0, sat: 0, sug: 0, fib: 0, salt: 0, unknown: {} };
    for (const e of list) { const n = entryNutr(e); for (const k of Object.keys(t)) { if (k === 'unknown') continue; if (n[k] == null) t.unknown[k] = true; else t[k] += n[k]; } }
    return t;
  }
  async function copyDay(from, to, meal) {
    const src = (await getDay(from)).filter((e) => !meal || e.meal === meal);
    for (const e of src) await tx(perDB, 'entries', 'readwrite', (s) => s.put(Object.assign({}, e, { id: uid(), date: to, ts: Date.now() })));
    return src.length;
  }
  async function getWater(date) { const w = await kvGet('water', {}); return w[date || today()] || 0; }
  async function addWater(ml, date) { const w = await kvGet('water', {}); const d = date || today(); w[d] = Math.max(0, (w[d] || 0) + ml); await kvSet('water', w); return w[d]; }
  async function getWeights() { return kvGet('weights', []); }
  async function addWeight(kg, date) { const d = date || today(); const ws = (await getWeights()).filter((w) => w.date !== d); ws.push({ date: d, kg }); ws.sort((a, b) => a.date < b.date ? -1 : 1); await kvSet('weights', ws); return ws; }

  // ---------------- Ziele & Profil ----------------
  const DEFAULT_GOALS = { kcal: 2200, p: 150, c: 230, f: 70, water: 2500 };
  // Bedarf aus dem Rechner „Mein Bedarf“ der Haupt-App (index.html schreibt mc_bedarf)
  function appBedarf() { try { const b = JSON.parse(localStorage.getItem('mc_bedarf') || 'null'); if (b && b.kcal > 800) return { kcal: b.kcal, p: b.p, c: b.c, f: b.f, water: b.water || DEFAULT_GOALS.water, src: 'app' }; } catch (e) { /* ignore */ } return null; }
  async function getGoals() { const own = await kvGet('goals', null); if (own && own.src !== 'app') return Object.assign({}, DEFAULT_GOALS, own); return Object.assign({}, DEFAULT_GOALS, appBedarf() || {}); }
  const setGoals = (g) => kvSet('goals', g);
  function calcGoals({ kg, cm, age, sex, activity = 1.45, aim = 'aufbau', proteinPerKg = 2 }) {
    const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'w' ? -161 : 5); // Mifflin-St Jeor
    const tdee = bmr * activity;
    const kcal = Math.round((aim === 'abnehmen' ? tdee - 450 : aim === 'aufbau' ? tdee + 300 : tdee) / 10) * 10;
    const p = Math.round(kg * proteinPerKg); const f = Math.round(kg * (aim === 'abnehmen' ? 0.8 : 1));
    const c = Math.max(50, Math.round((kcal - p * 4 - f * 9) / 4));
    return { kcal, p, c, f, water: Math.round(kg * 35 / 50) * 50, bmr: Math.round(bmr), tdee: Math.round(tdee) };
  }
  // Versucht, Profilwerte des bestehenden Dr.-Muskel-Coach-Profils zu finden (gleiche Domain → gleicher localStorage).
  function findProfile() {
    const pick = (o, keys) => { for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase())) { const v = parseFloat(String(o[k]).replace(',', '.')); if (!isNaN(v)) return v; } return null; };
    try { // 1. Profil des Dr. Muskel Coach (mc_prof: w = Gewicht, h = Größe)
      const mp = JSON.parse(localStorage.getItem('mc_prof') || 'null');
      if (mp) { const kg = parseFloat(String(mp.w).replace(',', '.')); const cm = parseFloat(mp.h); const age = parseFloat(mp.age);
        if (kg > 30 && cm > 120) return { kg, cm, age: age || 30, sex: mp.sex === 'w' ? 'w' : 'm', aim: mp.goal === 'aufbau' ? 'aufbau' : (mp.goal === 'ab' || mp.goal === 'def') ? 'abnehmen' : 'halten', from: 'mc_prof' }; }
    } catch (e) { /* ignore */ }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i); let v; try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { continue; }
        const objs = [v]; if (v && typeof v === 'object') Object.values(v).forEach((x) => { if (x && typeof x === 'object') objs.push(x); });
        for (const o of objs) {
          if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
          const kg = pick(o, ['gewicht', 'weight', 'kg', 'koerpergewicht']); const cm = pick(o, ['groesse', 'größe', 'height', 'cm', 'size']); const age = pick(o, ['alter', 'age']);
          if (kg && cm && kg > 30 && kg < 300 && cm > 120 && cm < 230) {
            const sexRaw = String(o.geschlecht || o.gender || o.sex || '').toLowerCase();
            return { kg, cm, age: age || 30, sex: /^(w|f|frau|female|weib)/.test(sexRaw) ? 'w' : 'm', from: key };
          }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------------- Favoriten / Zuletzt / Häufig / Eigene ----------------
  async function toggleFav(id) { if (favs.has(id)) favs.delete(id); else favs.add(id); await kvSet('favs', [...favs]); return favs.has(id); }
  const isFav = (id) => favs.has(id);
  const listFavs = () => [...favs].map((id) => byId.get(id)).filter(Boolean);
  async function listRecent() { return (await kvGet('recent', [])).map((id) => byId.get(id)).filter(Boolean); }
  const listFrequent = () => Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => byId.get(id)).filter(Boolean);
  const listCustom = () => foods.filter((f) => f.src === 'user' || f.src === 'recipe');
  async function saveCustom(f) {
    f.id = f.id || (f.src === 'recipe' ? 'rec:' : 'user:') + uid(); f.src = f.src || 'user'; f.q = f.src === 'recipe' ? 'recipe' : 'user'; f.cat = f.cat || 'O';
    const clean = JSON.parse(JSON.stringify(f, (k, v) => (k.startsWith('_') ? undefined : v)));
    await tx(perDB, 'custom', 'readwrite', (s) => s.put(clean)); indexFood(f); return f;
  }
  async function deleteCustom(id) { await tx(perDB, 'custom', 'readwrite', (s) => s.delete(id)); const f = byId.get(id); if (f) { foods.splice(foods.indexOf(f), 1); byId.delete(id); } }
  function buildRecipe(name, ings, servings) { // ings: [{food, grams}]
    const total = ings.reduce((a, i) => a + i.grams, 0); const r = { n: name, src: 'recipe', unit: 'g', ings: ings.map((i) => [i.food.id, i.grams, i.food.n]) };
    NUTR.forEach((k) => { let s = 0; let unk = false; ings.forEach((i) => { if (i.food[k] == null) unk = true; else s += i.food[k] * i.grams / 100; }); r[k] = unk ? null : round(s * 100 / total, 1); });
    r.portion = { g: Math.round(total / (servings || 1)), label: '1 Portion (' + (servings || 1) + ' Port. gesamt)' };
    return r;
  }

  // ---------------- Open Food Facts (online) ----------------
  const OFF_FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,stores,quantity,serving_size,serving_quantity,nutriments,allergens_tags,ingredients_text_de,ingredients_text,last_modified_t,categories_tags';
  const callLog = [];
  function rateOk(kind, perMin) { const now = Date.now(); while (callLog.length && now - callLog[0].t > 60000) callLog.shift(); if (callLog.filter((c) => c.k === kind).length >= perMin) return false; callLog.push({ k: kind, t: now }); return true; }
  function mapOFF(p) {
    if (!p) return null; const nu = p.nutriments || {};
    const g = (k) => { const v = nu[k + '_100g']; return v === undefined || v === '' || v === null ? null : Number(v); };
    const name = p.product_name_de || p.product_name || p.generic_name_de; if (!name) return null;
    let kcal = g('energy-kcal'); const kj = g('energy-kj') ?? g('energy');
    if (kcal == null && kj != null) kcal = round(kj / 4.184);
    const liquid = /\d\s*(ml|cl|l)\b/i.test(p.quantity || '') || /beverages|getraenke/.test((p.categories_tags || []).join(' '));
    return {
      id: 'off:' + p.code, ean: p.code, n: name, brand: (p.brands || '').split(',')[0].trim() || null, store: p.stores || null,
      src: 'off', q: 'mfr', cat: 'O', unit: liquid ? 'ml' : 'g',
      kcal, kj, p: g('proteins'), c: g('carbohydrates'), f: g('fat'), sat: g('saturated-fat'), sug: g('sugars'), fib: g('fiber'), salt: g('salt'),
      portion: p.serving_quantity ? { g: Number(p.serving_quantity), label: p.serving_size || '1 Portion' } : null,
      allergens: (p.allergens_tags || []).map((a) => a.replace(/^\w\w:/, '')).join(', ') || null,
      ingredients: p.ingredients_text_de || p.ingredients_text || null,
      updated: p.last_modified_t ? new Date(p.last_modified_t * 1000).toISOString().slice(0, 10) : null,
      license: 'ODbL – © Open Food Facts contributors',
    };
  }
  async function cacheOFF(f) { const c = JSON.parse(JSON.stringify(f, (k, v) => (k.startsWith('_') ? undefined : v))); await tx(pubDB, 'offcache', 'readwrite', (s) => s.put(c)); indexFood(f); }
  async function lookupBarcode(code) {
    code = String(code).replace(/\D/g, '');
    if (byEan.has(code)) return byEan.get(code);
    if (!navigator.onLine) throw new Error('offline');
    if (!rateOk('prod', 60)) throw new Error('rate');
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}&lc=de`);
    if (!r.ok && r.status !== 404) throw new Error('http ' + r.status);
    const j = await r.json(); if (j.status !== 1) return null;
    const f = mapOFF(j.product); if (f) await cacheOFF(f); return f;
  }
  async function searchOnline(q) {
    if (!navigator.onLine) throw new Error('offline');
    if (!rateOk('search', 8)) throw new Error('rate');
    const u = `https://de.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
    const r = await fetch(u); if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    return (j.products || []).map(mapOFF).filter((f) => f && f.kcal != null);
  }

  // ---------------- Coach-Wissen (für Voice-Coach) ----------------
  let pending = null;
  const NUT_WORDS = [
    [/kalorien|kcal|energie|calories/, 'kcal', 'Kalorien', 'kcal'],
    [/eiweiss|protein/, 'p', 'Eiweiß', 'g'],
    [/kohlenhydrate|kohlenhydrat|carbs?|kh\b/, 'c', 'Kohlenhydrate', 'g'],
    [/zucker|sugar/, 'sug', 'Zucker', 'g'],
    [/ballaststoff|fiber|fibre/, 'fib', 'Ballaststoffe', 'g'],
    [/gesaettigte/, 'sat', 'gesättigte Fettsäuren', 'g'],
    [/fett|fat/, 'f', 'Fett', 'g'],
    [/salz|salt/, 'salt', 'Salz', 'g'],
  ];
  const nutrOf = (n) => { for (const w of NUT_WORDS) if (w[0].test(n)) return w; return null; };
  const disp = (f) => f.n.split(/,\s/)[0];
  const qualNote = (f) => f.q === 'est' ? ' (Schätzwert)' : f.src === 'off' ? ' (Herstellerangabe)' : '';

  async function daySummaryText() {
    const list = await getDay(today()); const t = sumEntries(list); const g = await getGoals(); const w = await getWater();
    if (!list.length) return `Heute ist noch nichts eingetragen. Dein Ziel sind ${fmt(g.kcal)} Kalorien und ${fmt(g.p)} Gramm Eiweiß.`;
    const rest = g.kcal - t.kcal; const pr = g.p - t.p;
    let s = `Heute hast du ${fmt(t.kcal)} von ${fmt(g.kcal)} Kalorien. `;
    s += rest >= 0 ? `Du hast noch ${fmt(rest)} übrig. ` : `Du liegst ${fmt(-rest)} drüber. `;
    s += `Eiweiß: ${fmt(t.p)} von ${fmt(g.p)} Gramm`;
    s += pr > 5 ? `, es fehlen noch ${fmt(pr)}. ` : ', Ziel erreicht – stark! ';
    s += `Kohlenhydrate ${fmt(t.c)} Gramm, Fett ${fmt(t.f)} Gramm. Wasser: ${fmt(w / 1000, 1)} Liter.`;
    return s;
  }
  // gute, alltagstaugliche Eiweißquellen aus der echten Datenbank auswählen
  const PROTEIN_PICKS = ['bls:M713100', 'bls:M710100', 'bls:V416182', 'bls:V486182', 'bls:T121902', 'bls:M711100', 'bls:E111100', 'bls:H861000', 'bls:T410100', 'bls:U010182', 'bls:B881100', 'bls:H210100'];
  async function suggestText(need) {
    const g = await getGoals(); const t = sumEntries(await getDay(today()));
    const restK = g.kcal - t.kcal; const restP = g.p - t.p;
    const picks = PROTEIN_PICKS.map((id) => byId.get(id)).filter(Boolean)
      .map((f) => { const p = defaultPortion(f); const nu = nutrients(f, p.g); return { f, p, nu, ratio: nu.p / Math.max(1, nu.kcal) }; })
      .filter((x) => need === 'any' || restK <= 0 || x.nu.kcal <= Math.max(150, restK))
      .sort((a, b) => b.ratio - a.ratio).slice(0, 4);
    if (!picks.length) return 'Ich habe gerade keine passende Empfehlung.';
    let s = restP > 5 ? `Dir fehlen noch ${fmt(restP)} Gramm Eiweiß bei ${fmt(Math.max(0, restK))} Kalorien übrig. Gute Optionen: ` : 'Eiweißreiche Optionen: ';
    s += picks.map((x) => `${disp(x.f).split(',')[0]} (${x.p.label.replace(/^1 /, '')}, ${fmt(x.p.g)} g) mit ${fmt(x.nu.p)} g Eiweiß und ${fmt(x.nu.kcal)} kcal`).join('; ') + '.';
    return s;
  }

  function parseNutrQuestion(n) {
    // „wie viel eiweiß hat/haben/hat ein/ist in/steckt in X“
    const m = n.match(/(?:wie ?viele?|wieviele?|how much|how many)\s+(.+?)\s+(?:hat|haben|hat ein|hat eine|hat einen|ist in|sind in|steckt in|stecken in|stecken|in|enthaelt|enthalten|has|is in|are in)\s+(.+)$/);
    if (m) { const w = nutrOf(m[1]); if (w) return { w, item: m[2] }; }
    const m2 = n.match(/^(?:naehrwerte|naehrwert|kalorien|eiweiss|protein|nutrition)\s+(?:von|vom|fuer|of)\s+(.+)$/);
    if (m2) return { w: nutrOf(n) || NUT_WORDS[0], item: m2[1], all: /naehrwert|nutrition/.test(n) };
    return null;
  }

  async function answer(text) {
    await init();
    const n = norm(text).replace(/[?!.]+$/, '').trim();
    if (!n) return null;
    // Bestätigung offener Einträge
    if (pending) {
      if (/^(ja|jo|jep|jap|ok|okay|passt|genau|richtig|speicher|speichern|eintragen|trag ein|mach|klar|yes|sure|bestaetigen)\b/.test(n)) {
        const p = pending; pending = null; let c = 0;
        for (const it of p.items) { if (it.water) { await addWater(it.grams); c++; } else if (it.food && it.grams) { await addEntry({ food: it.food, grams: it.grams, meal: p.meal, date: p.date, label: it.label }); c++; } }
        return { kind: 'saved', text: `Erledigt, ${c} ${c === 1 ? 'Eintrag' : 'Einträge'} gespeichert. ` + await daySummaryText() };
      }
      if (/^(nein|ne|nee|abbrechen|stopp|stop|falsch|no|cancel|vergiss)\b/.test(n)) { pending = null; return { kind: 'cancel', text: 'Okay, nichts eingetragen. Sag es mir einfach nochmal anders oder korrigiere es in der Ernährungsseite.' }; }
    }
    // Wasser
    const wm = n.match(/(\d+(?:[.,]\d+)?|ein|eine|zwei|drei|vier|fuenf|halbe?n?)\s*(ml|l|liter|glas|glaeser|flaschen?)\s*(?:wasser|water)/) || (/(wasser|water) getrunken|getrunken.*wasser/.test(n) ? [null, '1', 'glas'] : null);
    if (wm && !/cola|saft|bier|milch|gegessen|\bund\b|,/.test(n)) {
      const q = NUMW[wm[1]] != null ? NUMW[wm[1]] : parseFloat(wm[1].replace(',', '.'));
      const ml = /^l|liter/.test(wm[2]) ? q * 1000 : wm[2] === 'ml' ? q : /flasche/.test(wm[2]) ? q * 500 : q * 250;
      const tot = await addWater(ml); const g = await getGoals();
      return { kind: 'water', text: `${fmt(ml)} Milliliter Wasser eingetragen. Heute: ${fmt(tot / 1000, 1)} von ${fmt(g.water / 1000, 1)} Litern.` };
    }
    // Gewicht
    const gm = n.match(/(?:ich wiege|mein gewicht (?:ist|betraegt)|gewicht|i weigh)\s*(?:heute\s*)?(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)?/);
    if (gm) {
      const kg = parseFloat(gm[1].replace(',', '.')); const ws = await addWeight(kg); const prev = ws.length > 1 ? ws[ws.length - 2] : null;
      let s = `Gewicht ${fmt(kg, 1)} Kilo gespeichert.`; if (prev) { const d = kg - prev.kg; s += d === 0 ? ' Gleich wie beim letzten Mal.' : ` Das sind ${fmt(Math.abs(d), 1)} Kilo ${d < 0 ? 'weniger' : 'mehr'} als am ${prev.date.split('-').reverse().join('.')}.`; }
      return { kind: 'weight', text: s };
    }
    // Tagesbilanz
    if (/uebrig|wie viel (darf|kann) ich noch|tagesbilanz|\bbilanz\b|wie stehe ich|(heute|bisher) (schon )?(gegessen|zu mir genommen)|wie viele? (kalorien|kcal|eiweiss|protein|kohlenhydrate|fett) (habe|hab|hatte) ich|how much.*left/.test(n)) {
      return { kind: 'summary', text: await daySummaryText() };
    }
    // Vergleich
    const cm = n.match(/(?:was|welches|wer) hat mehr\s+(\w+)\s*,?\s*(.+?)\s+oder\s+(.+)$/);
    if (cm) {
      const w = nutrOf(cm[1]) || NUT_WORDS[1]; const a = search(cm[2], { limit: 1 })[0]; const b = search(cm[3], { limit: 1 })[0];
      if (a && b) {
        const va = a[w[1]]; const vb = b[w[1]];
        if (va == null || vb == null) return { kind: 'compare', text: `Für eines der beiden ist ${w[2]} unbekannt.` };
        const win = va === vb ? null : va > vb ? a : b;
        return { kind: 'compare', text: `Pro 100 Gramm: ${disp(a)} hat ${fmt(va, 1)} ${w[3]} ${w[2]}, ${disp(b)} hat ${fmt(vb, 1)} ${w[3]}. ` + (win ? `Mehr hat also ${disp(win).split(',')[0]}.` : 'Beide gleich.') };
      }
    }
    // Nährwertfrage
    const nq = parseNutrQuestion(n);
    if (nq) {
      const parsed = parseMeal(nq.item); const it = parsed.items.find((i) => i.food);
      if (!it) return { kind: 'unknown', text: `Dazu finde ich in der Offline-Datenbank nichts. Probier die Online-Suche oder den Barcode-Scanner in der Ernährungsseite.` };
      const f = it.food; const hasAmount = !!(it.unit || it.size || (it.qty != null && it.qty !== 1)); const grams = it.grams;
      const nu = nutrients(f, grams); const w = nq.w;
      const per100 = f[w[1]]; const unitW = f.unit === 'ml' ? 'Milliliter' : 'Gramm';
      if (per100 == null && w[1] !== 'kcal') return { kind: 'nutr', text: `Für ${disp(f)} ist der Wert für ${w[2]} unbekannt.` };
      let s = `${disp(f)}${qualNote(f)}: ${fmt(per100, w[1] === 'kcal' ? 0 : 1)} ${w[3] === 'kcal' ? 'Kalorien' : 'Gramm ' + w[2]} pro 100 ${unitW}. `;
      s += `${hasAmount ? 'Bei deiner Menge' : 'Bei ' + (it.label || '1 Portion').replace(/^1 /, '1 ')} (${fmt(grams)} ${f.unit === 'ml' ? 'ml' : 'g'}) sind das ${fmt(nu[w[1]], w[1] === 'kcal' ? 0 : 1)} ${w[3] === 'kcal' ? 'Kalorien' : 'Gramm'}.`;
      if (nq.all || w[1] === 'kcal') s += ` Dazu ${fmt(nu.p)} g Eiweiß, ${fmt(nu.c)} g Kohlenhydrate und ${fmt(nu.f)} g Fett.`;
      return { kind: 'nutr', text: s, food: f };
    }
    // Empfehlungen
    if (/(was (soll|kann) ich (noch|jetzt|heute)? ?essen)|essensvorschlag|was (fehlt|esse ich) noch/.test(n)) return { kind: 'suggest', text: await suggestText('fit') };
    if (/(gute|beste|eiweissreiche|proteinreiche) (eiweiss|protein)?(quellen|lebensmittel)|was hat viel (eiweiss|protein)|(eiweiss|protein)quellen/.test(n)) return { kind: 'suggest', text: await suggestText('any') };
    // Mahlzeit eintragen
    if ((/\b(gegessen|getrunken|hatte|trage|trag|eintragen|notier\w*|ate|had|drank|log)\b/.test(n) && !/^(was|wie|welche\w*|wann|soll|kann|what|how|which)\b/.test(n)) || /^\d+\s*(g|gramm|ml)\b/.test(n)) {
      const r = parseMeal(text); const items = r.items.filter((i) => i.food || i.water);
      if (!items.length) return { kind: 'unknown', text: 'Ich konnte keine Lebensmittel erkennen. Sag zum Beispiel: 250 Gramm gekochter Reis und 200 Gramm Putenbrust.' };
      pending = { meal: r.meal, date: r.date, items };
      const tot = items.filter((i) => i.food).reduce((a, i) => { const nu = nutrients(i.food, i.grams); a.k += nu.kcal || 0; a.p += nu.p || 0; return a; }, { k: 0, p: 0 });
      const parts = items.map((i) => i.water ? `${fmt(i.grams)} ml Wasser` : `${disp(i.food)} (${i.label || fmt(i.grams) + ' g'}${i.est ? ', geschätzte Menge' : ''})`);
      const missed = r.items.filter((i) => !i.food && !i.water).map((i) => i.query);
      let s = `Ich habe erkannt: ${parts.join(', ')}. Zusammen etwa ${fmt(tot.k)} Kalorien und ${fmt(tot.p)} Gramm Eiweiß. `;
      if (missed.length) s += `Nicht gefunden: ${missed.join(', ')}. `;
      if (items.some((i) => i.flags && i.flags.includes('rohgekocht'))) s += 'Achtung, prüf kurz ob roh oder gekocht gemeint ist. ';
      s += `Soll ich das als ${(api.lang === 'en' ? MEAL_EN : MEAL_DE)[r.meal]} eintragen?`;
      return { kind: 'confirm', text: s, pending };
    }
    return null; // nicht zuständig → bestehender Coach antwortet
  }

  // ---------------- Backup ----------------
  async function exportData() {
    const entries = await tx(perDB, 'entries', 'readonly', (s) => s.getAll()); const custom = await tx(perDB, 'custom', 'readonly', (s) => s.getAll());
    const kv = {}; for (const k of ['goals', 'water', 'weights', 'favs', 'recent', 'usage', 'lang']) kv[k] = await kvGet(k, null);
    return { app: 'Dr. Muskel Coach Ernährung', version: VERSION, exported: new Date().toISOString(), entries, custom, kv };
  }
  async function importData(d) {
    if (!d || !Array.isArray(d.entries)) throw new Error('Ungültige Datei');
    for (const e of d.entries) await tx(perDB, 'entries', 'readwrite', (s) => s.put(e));
    for (const c of d.custom || []) { await tx(perDB, 'custom', 'readwrite', (s) => s.put(c)); indexFood(c); }
    for (const [k, v] of Object.entries(d.kv || {})) if (v != null) await kvSet(k, v);
    usage = await kvGet('usage', {}); favs = new Set(await kvGet('favs', []));
  }

  const api = {
    VERSION, MEALS, MEAL_DE, MEAL_EN, base: './', lang: 'de', ready: false,
    init, search, getFood: (id) => byId.get(id), byEan: (c) => byEan.get(String(c)), count: () => foods.length,
    countBy: () => foods.reduce((a, f) => { a[f.src] = (a[f.src] || 0) + 1; return a; }, {}),
    catName: (c) => catNames[c] || (c === 'O' ? 'Markenprodukte' : c === 'Z' ? 'Imbiss & Fast Food (Schätzwerte)' : c),
    sources, norm, nutrients, portionsFor, defaultPortion, parseMeal, answer, getPending: () => pending, clearPending: () => { pending = null; },
    addEntry, updateEntry, removeEntry, getDay, getRange, entryNutr, sumEntries, copyDay,
    getWater, addWater, getWeights, addWeight, getGoals, setGoals, calcGoals, findProfile, appBedarf,
    toggleFav, isFav, listFavs, listRecent, listFrequent, listCustom, saveCustom, deleteCustom, buildRecipe,
    lookupBarcode, searchOnline, exportData, importData, today, addDays, dateKey, fmt, kvGet, kvSet,
    setLang: async (l) => { api.lang = l; await kvSet('lang', l); },
  };
  window.DMCFood = api;
})();
