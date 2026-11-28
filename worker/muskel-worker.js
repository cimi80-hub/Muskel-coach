/**
 * Dr. Muskel Coach – Server (Cloudflare Worker + D1, kostenloses Kontingent)
 * Feedback & Bewertungen + anonyme Nutzungsstatistik (Zähler) für den Entwicklerbereich + Freunde & Gruppen (freiwillig, Spitzname).
 *
 * Bindings / Einstellungen im Cloudflare-Dashboard:
 *   D1-Datenbank  → Binding-Name  DB
 *   Secret        → ADMIN_KEY     (langes Passwort nur für dich; wird serverseitig geprüft)
 *   Secret        → SALT          (beliebige lange Zeichenfolge; anonymisiert IP-Adressen für den Spamschutz)
 *   Variable (opt.) ALLOWED_ORIGINS  z. B. "https://cimi80-hub.github.io"
 *
 * Gespeichert wird nur: Sterne, Name (freiwillig, sonst „Anonym“), Kommentar, Datum, App-Version, Sprache.
 * Statistik: nur anonyme Zähler (Schlüssel → Zahl), z. B. „heute aktiv“, Länder-Zähler. Keine Geräte-IDs.
 * Keine IP-Adressen. Für den Spamschutz wird ein Einweg-Hash (IP + SALT + Tag) max. 48 h gehalten.
 */
const LIMIT_HOUR = 3;        // Einsendungen je Gerät/Netz pro Stunde
const LIMIT_DAY = 10;        // … pro Tag
const ADMIN_FAIL_LIMIT = 10; // falsche Admin-Versuche pro Stunde je Netz
const ADMIN_FAIL_GLOBAL = 30; // falsche Admin-Versuche pro Stunde insgesamt (Schutz gegen Durchprobieren von vielen Adressen)
const DEFAULT_ORIGINS = ['https://cimi80-hub.github.io'];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      name TEXT NOT NULL DEFAULT 'Anonym',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      app_version TEXT, lang TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_fb_created ON feedback(created_at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS rate (k TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_rate ON rate(k, kind, ts)'),
    db.prepare('CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID'),
    db.prepare('CREATE TABLE IF NOT EXISTS food_ean (ean TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT) WITHOUT ROWID'),
  ]);
  schemaReady = true;
}

function origins(env) {
  return (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS).filter(Boolean);
}
function cors(req, env) {
  const o = req.headers.get('Origin') || '';
  const allow = origins(env).includes(o) ? o : origins(env)[0];
  return {
    'Access-Control-Allow-Origin': allow, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mid, X-Msec',
    'Access-Control-Max-Age': '86400',
  };
}
const json = (req, env, data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req, env) } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) { // zeitkonstanter Vergleich
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
  return d === 0;
}
async function clientKey(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
  return sha256((env.SALT || 'salt') + '|' + ip + '|' + new Date().toISOString().slice(0, 10));
}
async function countSince(db, k, kind, sinceMs) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM rate WHERE k = ? AND kind = ? AND ts > ?').bind(k, kind, sinceMs).first();
  return (r && r.n) || 0;
}
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, max);

async function postFeedback(req, env) {
  const db = env.DB;
  let body; try { body = await req.json(); } catch (e) { return json(req, env, { ok: false, error: 'bad_json' }, 400); }
  // Spamschutz 1: Honeypot-Feld muss leer bleiben, Formular nicht in < 2,5 s ausgefüllt
  if (body.hp) return json(req, env, { ok: true }); // still verwerfen
  if (!(Number(body.t) >= 2500)) return json(req, env, { ok: false, error: 'too_fast' }, 400);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json(req, env, { ok: false, error: 'rating' }, 400);
  const name = clean(body.name, 40) || 'Anonym';
  const comment = clean(body.comment, 1500);
  if ((comment.match(/https?:\/\/|www\./gi) || []).length > 2) return json(req, env, { ok: false, error: 'links' }, 400);
  // Spamschutz 2: Begrenzung je Netz (anonymisiert)
  const k = await clientKey(req, env); const now = Date.now();
  const [h, d] = await Promise.all([countSince(db, k, 'fb', now - 3600e3), countSince(db, k, 'fb', now - 86400e3)]);
  if (h >= LIMIT_HOUR || d >= LIMIT_DAY) return json(req, env, { ok: false, error: 'rate' }, 429);
  await db.batch([
    db.prepare('INSERT INTO feedback (rating, name, comment, created_at, app_version, lang) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(rating, name, comment, new Date().toISOString(), clean(body.v, 20) || null, clean(body.lang, 5) || null),
    db.prepare('INSERT INTO rate (k, kind, ts) VALUES (?, ?, ?)').bind(k, 'fb', now),
    db.prepare('DELETE FROM rate WHERE ts < ?').bind(now - 2 * 86400e3),
  ]);
  return json(req, env, { ok: true });
}

async function isAdmin(req, env) {
  const k = await clientKey(req, env); const now = Date.now();
  if (await countSince(env.DB, k, 'adminfail', now - 3600e3) >= ADMIN_FAIL_LIMIT) return 'locked';
  const g = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate WHERE kind = 'adminfail' AND ts > ?").bind(now - 3600e3).first();
  if (g && g.n >= ADMIN_FAIL_GLOBAL) return 'locked';
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (env.ADMIN_KEY && env.ADMIN_KEY.length >= 6 && safeEqual(token, env.ADMIN_KEY)) return 'ok';
  await env.DB.prepare('INSERT INTO rate (k, kind, ts) VALUES (?, ?, ?)').bind(k, 'adminfail', now).run();
  return 'denied';
}

async function adminList(req, env, url) {
  const sort = url.searchParams.get('sort') === 'stars' ? 'rating' : 'created_at';
  const dir = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const order = sort === 'rating' ? `rating ${dir}, created_at DESC` : `created_at ${dir}`;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  const [items, stats, dist] = await Promise.all([
    env.DB.prepare(`SELECT id, rating, name, comment, created_at, app_version, lang FROM feedback ORDER BY ${order} LIMIT ?`).bind(limit).all(),
    env.DB.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM feedback').first(),
    env.DB.prepare('SELECT rating, COUNT(*) AS n FROM feedback GROUP BY rating').all(),
  ]);
  const d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; (dist.results || []).forEach((r) => { d[r.rating] = r.n; });
  return json(req, env, { ok: true, count: stats.count || 0, avg: stats.avg == null ? null : Math.round(stats.avg * 100) / 100, dist: d, items: items.results || [] });
}


/* ===================== Statistik (Zähler) ===================== */
const ON_W = 120000;                 // Online-Fenster der App (2 Min.)
const EV_MAX = 10;                   // Zähler pro Anfrage
const EV_LIMIT = 400;                // Zähler je Netz (anonym) pro 10 Min. – großzügig wegen Mobilfunk-Sammel-IPs
const ymdUTC = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
function dateOk(s) { // nur gestern/heute/morgen (Zeitzonen-Spielraum) – alte Tage sind unveränderlich
  const now = Date.now(); return [-1, 0, 1].some((o) => ymdUTC(now + o * 86400e3) === s);
}
function keyOk(k) {
  if (typeof k !== 'string' || k.length > 24) return false;
  if (/^(users|inst|pro-users|unlocks|(um|uc|bad|reuse)-all)$/.test(k)) return true;
  let m;
  if ((m = k.match(/^(d|di|n|um|uc|bad|reuse)-(\d{8})$/))) return dateOk(m[2]);
  if (/^cc-[A-Z]{2}$/.test(k)) return true;
  if (/^c-\d{6}$/.test(k)) return true;
  if ((m = k.match(/^on-(\d{6,10})$/))) return Math.abs(Number(m[1]) - Math.floor(Date.now() / ON_W)) <= 1;
  return false;
}
const evRate = new Map(); // pro Worker-Instanz, kostet keine Datenbank-Schreibvorgänge
function evAllowed(k, n) {
  const now = Date.now(); let e = evRate.get(k);
  if (!e || now - e.t > 600e3) { e = { t: now, n: 0 }; evRate.set(k, e); }
  if (evRate.size > 5000) evRate.clear();
  e.n += n; return e.n <= EV_LIMIT;
}
async function postEvents(req, env) {
  let body; try { body = await req.json(); } catch (e) { return json(req, env, { ok: false, error: 'bad_json' }, 400); }
  const keys = [...new Set(Array.isArray(body.k) ? body.k : [])].slice(0, EV_MAX).filter(keyOk);
  if (!keys.length) return json(req, env, { ok: false, error: 'keys' }, 400);
  if (!evAllowed(await clientKey(req, env), keys.length)) return json(req, env, { ok: false, error: 'rate' }, 429);
  const r = await env.DB.prepare(`INSERT INTO counters (k, v) SELECT value, 1 FROM json_each(?) WHERE true
      ON CONFLICT(k) DO UPDATE SET v = v + 1 RETURNING k, v`).bind(JSON.stringify(keys)).all();
  const out = {}; (r.results || []).forEach((x) => { out[x.k] = x.v; });
  if (Math.random() < 0.01) { // alte Online-Zähler aufräumen (älter als 1 Tag)
    const old = Math.floor(Date.now() / ON_W) - 720;
    await env.DB.prepare("DELETE FROM counters WHERE k >= 'on-' AND k < ?").bind('on-' + old).run();
  }
  return json(req, env, { ok: true, v: out });
}
const RANGES = [['cc-', 'cc.'], ['um-2', 'um-3'], ['uc-2', 'uc-3'], ['bad-2', 'bad-3'], ['reuse-2', 'reuse-3']];
async function adminStats(req, env) {
  let body = {}; try { body = await req.json(); } catch (e) {}
  const keys = (Array.isArray(body.k) ? body.k : []).filter((k) => typeof k === 'string' && k.length <= 24).slice(0, 500);
  const db = env.DB;
  const res = await db.batch([
    db.prepare('SELECT k, v FROM counters WHERE k IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)),
    ...RANGES.map(([a, b]) => db.prepare('SELECT k, v FROM counters WHERE k >= ? AND k < ?').bind(a, b)),
    db.prepare('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM feedback'),
  ]);
  const v = {}; res.slice(0, 1 + RANGES.length).forEach((r) => (r.results || []).forEach((x) => { v[x.k] = x.v; }));
  const fb = (res[res.length - 1].results || [])[0] || {};
  return json(req, env, { ok: true, now: Date.now(), v, fb: { n: fb.n || 0, avg: fb.avg == null ? null : Math.round(fb.avg * 100) / 100 } });
}
async function adminImport(req, env) { // Altdaten aus Abacus: setzt höchstens hoch (MAX), nie runter – beliebig oft wiederholbar
  let body = {}; try { body = await req.json(); } catch (e) {}
  const items = (Array.isArray(body.items) ? body.items : []).filter((x) => Array.isArray(x) && typeof x[0] === 'string' && x[0].length <= 24
    && /^[a-z]+(-[A-Za-z0-9]+)*$/.test(x[0]) && Number.isInteger(x[1]) && x[1] >= 0 && x[1] < 1e9).slice(0, 1000);
  if (!items.length) return json(req, env, { ok: true, n: 0 });
  await env.DB.prepare(`INSERT INTO counters (k, v) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE true
      ON CONFLICT(k) DO UPDATE SET v = MAX(v, excluded.v)`).bind(JSON.stringify(items)).run();
  return json(req, env, { ok: true, n: items.length });
}

/* ===================== Freunde & Gruppen ===================== */
// Anonym: Spitzname + zufällige ID. Geheimnis nur als Hash gespeichert. Aktivitäten werden nach 90 Tagen gelöscht.
const FR_GROUP_MAX = 20;
const FR_ACT_KEEP = 90 * 86400e3;
const FR_EMOJI = ['💪', '🔥', '👏'];
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rid = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => ABC[x % ABC.length]).join(''); };
let frReady = false;
async function frSchema(db) {
  if (frReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS fr_members (id TEXT PRIMARY KEY, sh TEXT NOT NULL, nick TEXT NOT NULL, created INTEGER, last INTEGER,
      paused INTEGER NOT NULL DEFAULT 0, tot_tr INTEGER NOT NULL DEFAULT 0, tot_min INTEGER NOT NULL DEFAULT 0, tot_vol INTEGER NOT NULL DEFAULT 0, tot_pr INTEGER NOT NULL DEFAULT 0)`),
    db.prepare('CREATE TABLE IF NOT EXISTS fr_links (a TEXT NOT NULL, b TEXT NOT NULL, created INTEGER, PRIMARY KEY (a, b))'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_frl_b ON fr_links(b)'),
    db.prepare('CREATE TABLE IF NOT EXISTS fr_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL, created INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS fr_gm (g TEXT NOT NULL, m TEXT NOT NULL, joined INTEGER, PRIMARY KEY (g, m))'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_frgm_m ON fr_gm(m)'),
    db.prepare('CREATE TABLE IF NOT EXISTS fr_inv (code TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, created INTEGER, expires INTEGER)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS fr_acts (id INTEGER PRIMARY KEY AUTOINCREMENT, m TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_fra_m ON fr_acts(m, ts)'),
    db.prepare('CREATE TABLE IF NOT EXISTS fr_reacts (act INTEGER NOT NULL, m TEXT NOT NULL, e TEXT NOT NULL, PRIMARY KEY (act, m))'),
  ]);
  frReady = true;
}
const nickOk = (s) => clean(s, 24).replace(/[<>]/g, '');
async function frAuth(req, env) {
  const id = req.headers.get('X-Mid') || '', sec = req.headers.get('X-Msec') || '';
  if (!/^[A-Z0-9]{10}$/.test(id) || sec.length < 20) return null;
  const m = await env.DB.prepare('SELECT * FROM fr_members WHERE id = ?').bind(id).first();
  if (!m || !safeEqual(await sha256((env.SALT || 'salt') + '|fr|' + sec), m.sh)) return null;
  return m;
}
// alle Mitglieder, deren Aktivitäten ich sehen darf (ich, direkte Freunde, Mitglieder meiner Gruppen)
async function frVisible(db, me) {
  const r = await db.batch([
    db.prepare('SELECT b AS x FROM fr_links WHERE a = ? UNION SELECT a AS x FROM fr_links WHERE b = ?').bind(me, me),
    db.prepare('SELECT DISTINCT o.m AS x FROM fr_gm o JOIN fr_gm mine ON o.g = mine.g WHERE mine.m = ?').bind(me),
  ]);
  const friends = (r[0].results || []).map((x) => x.x);
  const s = new Set([me, ...friends, ...(r[1].results || []).map((x) => x.x)]);
  return { friends, all: [...s] };
}
const wkStart = (ms) => { // Montag 0 Uhr (deutsche Zeit, vereinfacht UTC+1)
  const d = new Date(ms + 3600e3); const day = (d.getUTCDay() + 6) % 7; d.setUTCHours(0, 0, 0, 0); return d.getTime() - day * 86400e3 - 3600e3;
};
async function friends(req, env, url) {
  const db = env.DB; await frSchema(db);
  const p = url.pathname.slice(3); // nach "/f/"
  let body = {}; if (req.method === 'POST') { try { body = await req.json(); } catch (e) {} }
  const J = (d, s) => json(req, env, d, s);
  if (p === 'register') {
    const k = await clientKey(req, env); const now = Date.now();
    if (await countSince(db, k, 'frreg', now - 86400e3) >= 30) return J({ ok: false, error: 'rate' }, 429);
    const nick = nickOk(body.nick); if (nick.length < 2) return J({ ok: false, error: 'nick' }, 400);
    const id = rid(10), sec = rid(32);
    await db.batch([
      db.prepare('INSERT INTO fr_members (id, sh, nick, created, last) VALUES (?, ?, ?, ?, ?)').bind(id, await sha256((env.SALT || 'salt') + '|fr|' + sec), nick, now, now),
      db.prepare('INSERT INTO rate (k, kind, ts) VALUES (?, ?, ?)').bind(k, 'frreg', now),
    ]);
    return J({ ok: true, id, secret: sec, nick });
  }
  const me = await frAuth(req, env); if (!me) return J({ ok: false, error: 'auth' }, 401);
  const now = Date.now();
  if (p === 'me') {
    const nick = body.nick != null ? nickOk(body.nick) : me.nick; if (nick.length < 2) return J({ ok: false, error: 'nick' }, 400);
    const paused = body.paused != null ? (body.paused ? 1 : 0) : me.paused;
    await db.prepare('UPDATE fr_members SET nick = ?, paused = ?, last = ? WHERE id = ?').bind(nick, paused, now, me.id).run();
    return J({ ok: true, nick, paused: !!paused });
  }
  if (p === 'delete') { // alles von mir löschen; eigene Gruppen werden aufgelöst
    const own = ((await db.prepare('SELECT id FROM fr_groups WHERE owner = ?').bind(me.id).all()).results || []).map((x) => x.id);
    const st = [
      db.prepare('DELETE FROM fr_reacts WHERE m = ? OR act IN (SELECT id FROM fr_acts WHERE m = ?)').bind(me.id, me.id),
      db.prepare('DELETE FROM fr_acts WHERE m = ?').bind(me.id),
      db.prepare('DELETE FROM fr_links WHERE a = ? OR b = ?').bind(me.id, me.id),
      db.prepare('DELETE FROM fr_gm WHERE m = ?').bind(me.id),
      db.prepare("DELETE FROM fr_inv WHERE kind = 'duo' AND ref = ?").bind(me.id),
      db.prepare('DELETE FROM fr_members WHERE id = ?').bind(me.id),
    ];
    for (const g of own.slice(0, 10)) st.push(db.prepare('DELETE FROM fr_gm WHERE g = ?').bind(g), db.prepare("DELETE FROM fr_inv WHERE kind = 'group' AND ref = ?").bind(g), db.prepare('DELETE FROM fr_groups WHERE id = ?').bind(g));
    await db.batch(st); return J({ ok: true });
  }
  if (p === 'invite') {
    let kind = 'duo', ref = me.id;
    if (body.g) { const g = await db.prepare('SELECT g FROM fr_gm WHERE g = ? AND m = ?').bind(String(body.g), me.id).first(); if (!g) return J({ ok: false, error: 'group' }, 403); kind = 'group'; ref = g.g; }
    const n = await db.prepare('SELECT COUNT(*) AS n FROM fr_inv WHERE ref = ? AND created > ?').bind(ref, now - 86400e3).first();
    if (n && n.n >= 30) return J({ ok: false, error: 'rate' }, 429);
    const code = rid(8);
    await db.batch([
      db.prepare('INSERT INTO fr_inv (code, kind, ref, created, expires) VALUES (?, ?, ?, ?, ?)').bind(code, kind, ref, now, now + 7 * 86400e3),
      db.prepare('DELETE FROM fr_inv WHERE expires < ?').bind(now),
    ]);
    return J({ ok: true, code, kind });
  }
  if (p === 'peek' || p === 'accept') {
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const inv = await db.prepare('SELECT * FROM fr_inv WHERE code = ? AND expires > ?').bind(code, now).first();
    if (!inv) return J({ ok: false, error: 'invalid' }, 404);
    if (inv.kind === 'duo') {
      const o = await db.prepare('SELECT id, nick FROM fr_members WHERE id = ?').bind(inv.ref).first();
      if (!o) return J({ ok: false, error: 'invalid' }, 404);
      if (o.id === me.id) return J({ ok: false, error: 'self' }, 400);
      const [a, b] = [me.id, o.id].sort();
      const has = await db.prepare('SELECT 1 AS x FROM fr_links WHERE a = ? AND b = ?').bind(a, b).first();
      if (p === 'peek') return J({ ok: true, kind: 'duo', nick: o.nick, already: !!has });
      await db.batch([db.prepare('INSERT OR IGNORE INTO fr_links (a, b, created) VALUES (?, ?, ?)').bind(a, b, now), db.prepare('DELETE FROM fr_inv WHERE code = ?').bind(code)]);
      return J({ ok: true, kind: 'duo', nick: o.nick });
    }
    const g = await db.prepare('SELECT grp.id, grp.name, (SELECT COUNT(*) FROM fr_gm x WHERE x.g = grp.id) AS n, (SELECT 1 FROM fr_gm y WHERE y.g = grp.id AND y.m = ?) AS mine FROM fr_groups grp WHERE grp.id = ?').bind(me.id, inv.ref).first();
    if (!g) return J({ ok: false, error: 'invalid' }, 404);
    if (p === 'peek') return J({ ok: true, kind: 'group', name: g.name, n: g.n, already: !!g.mine });
    if (!g.mine && g.n >= FR_GROUP_MAX) return J({ ok: false, error: 'full' }, 400);
    await db.prepare('INSERT OR IGNORE INTO fr_gm (g, m, joined) VALUES (?, ?, ?)').bind(g.id, me.id, now).run();
    return J({ ok: true, kind: 'group', name: g.name, g: g.id });
  }
  if (p === 'group') {
    const name = nickOk(body.name); if (name.length < 2) return J({ ok: false, error: 'name' }, 400);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM fr_groups WHERE owner = ?').bind(me.id).first();
    if (n && n.n >= 10) return J({ ok: false, error: 'limit' }, 400);
    const id = rid(10);
    await db.batch([db.prepare('INSERT INTO fr_groups (id, name, owner, created) VALUES (?, ?, ?, ?)').bind(id, name, me.id, now),
      db.prepare('INSERT INTO fr_gm (g, m, joined) VALUES (?, ?, ?)').bind(id, me.id, now)]);
    return J({ ok: true, g: id, name });
  }
  if (p === 'leave') {
    const g = await db.prepare('SELECT * FROM fr_groups WHERE id = ?').bind(String(body.g || '')).first();
    if (!g) return J({ ok: true });
    if (g.owner === me.id) await db.batch([db.prepare('DELETE FROM fr_gm WHERE g = ?').bind(g.id), db.prepare("DELETE FROM fr_inv WHERE kind = 'group' AND ref = ?").bind(g.id), db.prepare('DELETE FROM fr_groups WHERE id = ?').bind(g.id)]);
    else await db.prepare('DELETE FROM fr_gm WHERE g = ? AND m = ?').bind(g.id, me.id).run();
    return J({ ok: true, dissolved: g.owner === me.id });
  }
  if (p === 'kick') {
    const g = await db.prepare('SELECT * FROM fr_groups WHERE id = ? AND owner = ?').bind(String(body.g || ''), me.id).first();
    if (!g || body.m === me.id) return J({ ok: false, error: 'forbidden' }, 403);
    await db.prepare('DELETE FROM fr_gm WHERE g = ? AND m = ?').bind(g.id, String(body.m || '')).run(); return J({ ok: true });
  }
  if (p === 'unlink') {
    const [a, b] = [me.id, String(body.m || '')].sort();
    await db.prepare('DELETE FROM fr_links WHERE a = ? AND b = ?').bind(a, b).run(); return J({ ok: true });
  }
  if (p === 'act') {
    if (me.paused) return J({ ok: true, paused: true });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM fr_acts WHERE m = ? AND ts > ?').bind(me.id, now - 86400e3).first();
    if (n && n.n >= 12) return J({ ok: false, error: 'rate' }, 429);
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const prs = (Array.isArray(body.prs) ? body.prs : []).slice(0, 10).map((x) => ({ n: clean(x && x.n, 40), kg: Math.max(0, Math.min(1000, Number(x && x.kg) || 0)) })).filter((x) => x.n && x.kg);
    const d = { name: clean(body.name, 40), min: num(body.min, 600), ex: num(body.ex, 60), sets: num(body.sets, 300), vol: num(body.vol, 200000), prs };
    if (!d.sets) return J({ ok: false, error: 'empty' }, 400);
    const st = [
      db.prepare('INSERT INTO fr_acts (m, ts, data) VALUES (?, ?, ?)').bind(me.id, now, JSON.stringify(d)),
      db.prepare('UPDATE fr_members SET tot_tr = tot_tr + 1, tot_min = tot_min + ?, tot_vol = tot_vol + ?, tot_pr = tot_pr + ?, last = ? WHERE id = ?').bind(d.min, d.vol, prs.length, now, me.id),
    ];
    if (Math.random() < 0.05) st.push(db.prepare('DELETE FROM fr_reacts WHERE act IN (SELECT id FROM fr_acts WHERE ts < ?)').bind(now - FR_ACT_KEEP), db.prepare('DELETE FROM fr_acts WHERE ts < ?').bind(now - FR_ACT_KEEP));
    await db.batch(st); return J({ ok: true });
  }
  if (p === 'react') {
    const act = Number(body.act); const e = FR_EMOJI.includes(body.e) ? body.e : '';
    const a = await db.prepare('SELECT m FROM fr_acts WHERE id = ?').bind(act).first(); if (!a) return J({ ok: false, error: 'act' }, 404);
    const vis = await frVisible(db, me.id); if (!vis.all.includes(a.m)) return J({ ok: false, error: 'forbidden' }, 403);
    if (e) await db.prepare('INSERT INTO fr_reacts (act, m, e) VALUES (?, ?, ?) ON CONFLICT(act, m) DO UPDATE SET e = excluded.e').bind(act, me.id, e).run();
    else await db.prepare('DELETE FROM fr_reacts WHERE act = ? AND m = ?').bind(act, me.id).run();
    return J({ ok: true });
  }
  if (p === 'feed') {
    const vis = await frVisible(db, me.id); const V = JSON.stringify(vis.all); const since = now - 70 * 86400e3;
    const r = await db.batch([
      db.prepare('SELECT id, nick, tot_tr, tot_min, tot_vol, tot_pr, last, paused FROM fr_members WHERE id IN (SELECT value FROM json_each(?))').bind(V),
      db.prepare('SELECT g.id, g.name, g.owner, gm.m FROM fr_groups g JOIN fr_gm gm ON gm.g = g.id WHERE g.id IN (SELECT g FROM fr_gm WHERE m = ?) ORDER BY gm.joined').bind(me.id),
      db.prepare('SELECT id, m, ts, data FROM fr_acts WHERE m IN (SELECT value FROM json_each(?)) AND ts > ? ORDER BY ts DESC LIMIT 1500').bind(V, since),
      db.prepare('SELECT r.act, r.m, r.e FROM fr_reacts r JOIN (SELECT id FROM fr_acts WHERE m IN (SELECT value FROM json_each(?)) ORDER BY ts DESC LIMIT 60) x ON x.id = r.act').bind(V),
      db.prepare('UPDATE fr_members SET last = ? WHERE id = ?').bind(now, me.id),
    ]);
    const mem = {}; (r[0].results || []).forEach((x) => { mem[x.id] = x; });
    const groups = {}; (r[1].results || []).forEach((x) => { const g = groups[x.id] = groups[x.id] || { id: x.id, name: x.name, owner: x.owner, members: [] }; g.members.push(x.m); });
    const acts = (r[2].results || []).map((x) => ({ id: x.id, m: x.m, ts: x.ts, ...JSON.parse(x.data) }));
    const re = {}; (r[3].results || []).forEach((x) => { (re[x.act] = re[x.act] || []).push({ m: x.m, e: x.e }); });
    // Wochenwerte + Serie (Wochen in Folge mit mind. 2 Trainings)
    const w0 = wkStart(now), stats = {};
    for (const id of vis.all) stats[id] = { tr: 0, min: 0, vol: 0, pr: 0, streak: 0 };
    const perWeek = {};
    for (const a of acts) {
      const s = stats[a.m]; if (!s) continue;
      if (a.ts >= w0) { s.tr++; s.min += a.min || 0; s.vol += a.vol || 0; s.pr += (a.prs || []).length; }
      const wk = Math.round((w0 - wkStart(a.ts)) / (7 * 86400e3)); const k = a.m + '|' + wk; perWeek[k] = (perWeek[k] || 0) + 1;
    }
    for (const id of vis.all) { let n = 0, w = (perWeek[id + '|0'] || 0) >= 2 ? 0 : 1; while ((perWeek[id + '|' + w] || 0) >= 2) { n++; w++; } stats[id].streak = n; }
    const people = Object.values(mem).map((x) => ({ id: x.id, nick: x.nick, last: x.last, tot: { tr: x.tot_tr, min: x.tot_min, vol: x.tot_vol, pr: x.tot_pr }, wk: stats[x.id], friend: vis.friends.includes(x.id) }));
    return J({ ok: true, now, me: { id: me.id, nick: me.nick, paused: !!me.paused }, people, groups: Object.values(groups),
      acts: acts.slice(0, 60).map((a) => ({ ...a, re: re[a.id] || [] })) });
  }
  return J({ ok: false, error: 'not_found' }, 404);
}

/* ===================== Freischalt-Codes mit Laufzeit ===================== */
// 8-stellige Codes, nur auf dem Server erzeugt und geprüft; Laufzeit 1–12 Monate; jeder Code genau einmal.
let codeReady = false;
async function codeSchema(db) {
  if (codeReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, months INTEGER NOT NULL, created INTEGER, redeemed INTEGER, expires INTEGER, tag TEXT)').run();
  for (const col of ['expires INTEGER', 'tag TEXT']) { try { await db.prepare('ALTER TABLE codes ADD COLUMN ' + col).run(); } catch (e) { /* Spalte existiert schon */ } }
  codeReady = true;
}
async function adminCode(req, env) { // ein Code oder ein ganzer Stapel (Kooperationen)
  let body = {}; try { body = await req.json(); } catch (e) {}
  const months = Math.round(Number(body.months));
  if (!(months >= 1 && months <= 12)) return json(req, env, { ok: false, error: 'months' }, 400);
  const count = Math.max(1, Math.min(50, Math.round(Number(body.count) || 1)));
  const expires = Number(body.expires) > Date.now() ? Math.round(Number(body.expires)) : null;
  const tag = clean(body.tag, 40) || null;
  await codeSchema(env.DB);
  const out = [], now = Date.now();
  for (let round = 0; round < 3 && out.length < count; round++) {
    const want = new Set(); while (want.size < count - out.length) want.add(String(10000000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90000000)));
    const r = await env.DB.prepare(`INSERT INTO codes (code, months, created, expires, tag) SELECT value, ?, ?, ?, ? FROM json_each(?) WHERE true
        ON CONFLICT(code) DO NOTHING RETURNING code`).bind(months, now, expires, tag, JSON.stringify([...want])).all();
    (r.results || []).forEach((x) => out.push(x.code));
  }
  if (!out.length) return json(req, env, { ok: false, error: 'server' }, 500);
  return json(req, env, { ok: true, code: out[0], codes: out, months, expires, tag });
}
async function redeem(req, env) {
  let body = {}; try { body = await req.json(); } catch (e) {}
  const code = String(body.code || '').replace(/\D/g, '');
  const db = env.DB; await codeSchema(db);
  const k = await clientKey(req, env), now = Date.now();
  if (await countSince(db, k, 'codefail', now - 3600e3) >= 10) return json(req, env, { ok: false, error: 'rate' }, 429);
  const fail = async (error, status) => { await db.prepare('INSERT INTO rate (k, kind, ts) VALUES (?, ?, ?)').bind(k, 'codefail', now).run(); return json(req, env, { ok: false, error }, status); };
  if (!/^\d{8}$/.test(code)) return fail('invalid', 400);
  const row = await db.prepare('SELECT months, redeemed, expires FROM codes WHERE code = ?').bind(code).first();
  if (!row) return fail('invalid', 404);
  if (row.redeemed) return fail('used', 409);
  if (row.expires && now > row.expires) return json(req, env, { ok: false, error: 'expired' }, 410);
  const r = await db.prepare('UPDATE codes SET redeemed = ? WHERE code = ? AND redeemed IS NULL').bind(now, code).run();
  if (!(r.meta && r.meta.changes)) return fail('used', 409);
  await db.prepare("INSERT INTO counters (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1").bind('c-' + code).run();
  return json(req, env, { ok: true, months: row.months });
}


/* ===================== Lebensmittel-Suche (Open Food Facts + USDA FoodData Central) =====================
 * - Open Food Facts: Lizenz ODbL (Datenbank) / Inhalte DbCL – Quellenangabe „© Open Food Facts contributors“.
 * - USDA FoodData Central: gemeinfrei (CC0). Schlüssel optional als Secret FDC_API_KEY, sonst DEMO_KEY mit Tageslimit.
 * - Keine Nutzerdaten werden weitergegeben: an die Quellen geht nur der Suchbegriff bzw. der Barcode.
 * - Zwischenspeicher: Cloudflare-Cache (Suchen, 3 Tage) + D1 (Barcodes, 30 Tage) → wenige Anfragen an die Quellen.
 * - Fehlende Werte bleiben null (nie 0 erfinden); unplausible Datensätze werden aussortiert.
 */
const FOOD_UA = 'DrMuskelCoach/2.0 (https://cimi80-hub.github.io/Muskel-coach/)';
const OFF_FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,stores,quantity,serving_size,serving_quantity,nutriments,allergens_tags,ingredients_text_de,ingredients_text,categories_tags,last_modified_t,countries_tags';
const FOOD_UP = { n: 0, t: 0 }; // einfache Drossel je Worker-Instanz für Anfragen an die Quellen
function upOk(max) { const now = Date.now(); if (now - FOOD_UP.t > 60e3) { FOOD_UP.t = now; FOOD_UP.n = 0; } return ++FOOD_UP.n <= max; }
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function plausible(f) {
  if (f.kcal == null) return false;
  if (f.kcal < 0 || f.kcal > 950) return false;
  for (const k of ['p', 'c', 'f', 'sug', 'fib', 'sat']) if (f[k] != null && (f[k] < 0 || f[k] > 100)) return false;
  if (f.salt != null && (f.salt < 0 || f.salt > 100)) return false;
  if (f.sug != null && f.c != null && f.sug > f.c + 1) return false;
  if (f.sat != null && f.f != null && f.sat > f.f + 1) return false;
  if (f.p != null && f.c != null && f.f != null) {
    if (f.p + f.c + f.f > 105) return false;
    const calc = 4 * f.p + 4 * f.c + 9 * f.f + 2 * (f.fib || 0);
    if (Math.abs(calc - f.kcal) > Math.max(60, 0.35 * f.kcal) && !(f.kcal < 30 && calc < 60)) return false; // Alkohol/Polyole ausgenommen bei kleinen Werten
  }
  return true;
}
const firstStr = (v) => (Array.isArray(v) ? v[0] : v) || '';
function mapOFF(p) {
  if (!p) return null; const nu = p.nutriments || {};
  const g = (k) => num(nu[k + '_100g']);
  const name = String(p.product_name_de || firstStr(p.product_name) || p.generic_name_de || '').trim(); if (!name) return null;
  let kcal = g('energy-kcal'); const kj = g('energy-kj') ?? g('energy');
  if (kcal == null && kj != null) kcal = Math.round(kj / 4.184);
  const brands = (Array.isArray(p.brands) ? p.brands.join(',') : String(p.brands || '')).replace(/(^|,)\s*\w\w:/g, '$1');
  const cats = Array.isArray(p.categories_tags) ? p.categories_tags.join(' ') : '';
  const liquid = /\d\s*(ml|cl|l)\b/i.test(p.quantity || '') || /beverages|getraenke|drinks/.test(cats);
  const sq = num(p.serving_quantity);
  const f = {
    id: 'off:' + p.code, ean: String(p.code || ''), n: name.slice(0, 140), brand: brands.split(',')[0].trim() || null,
    store: ((Array.isArray(p.stores) ? p.stores.join(', ') : p.stores) || '').replace(/(^|, )\w\w:/g, '$1') || null,
    src: 'off', q: 'mfr', cat: 'O', unit: liquid ? 'ml' : 'g',
    kcal: kcal == null ? null : Math.round(kcal), kj: kj == null ? null : Math.round(kj),
    p: r1(g('proteins')), c: r1(g('carbohydrates')), f: r1(g('fat')), sat: r1(g('saturated-fat')), sug: r1(g('sugars')), fib: r1(g('fiber')),
    salt: g('salt') == null ? null : Math.round(g('salt') * 100) / 100, na: g('sodium') == null ? null : Math.round(g('sodium') * 1000) / 1000,
    portion: sq && sq > 0 && sq < 2000 ? { g: sq, label: String(p.serving_size || '1 Portion').slice(0, 40) } : null,
    allergens: (p.allergens_tags || []).map((a) => String(a).replace(/^\w\w:/, '')).join(', ') || null,
    ingredients: String(p.ingredients_text_de || p.ingredients_text || '').slice(0, 600) || null,
    de: Array.isArray(p.countries_tags) ? p.countries_tags.includes('en:germany') : undefined,
    updated: p.last_modified_t ? new Date(p.last_modified_t * 1000).toISOString().slice(0, 10) : null,
    license: 'ODbL – © Open Food Facts contributors',
  };
  return f.ean && plausible(f) ? f : null;
}
const FDC_N = { kcal: [1008, 2047, 2048], p: [1003], c: [1005], f: [1004], sat: [1258], sug: [2000, 1063], fib: [1079], na: [1093] };
function mapFDC(x) {
  if (!x || !x.description) return null;
  const by = {}; for (const n of x.foodNutrients || []) { const id = n.nutrientId || (n.nutrient && n.nutrient.id); const v = num(n.value ?? n.amount); if (id && v != null && by[id] === undefined) by[id] = { v, u: String(n.unitName || (n.nutrient && n.nutrient.unitName) || '').toLowerCase() }; }
  const pick = (k) => { for (const id of FDC_N[k]) if (by[id]) { const { v, u } = by[id]; if (k === 'kcal' && u === 'kj') return v / 4.184; return v; } return null; };
  const na = pick('na'); // mg
  const f = {
    id: 'fdc:' + x.fdcId, n: x.description.charAt(0) + x.description.slice(1).toLowerCase(), brand: x.brandOwner || x.brandName || null,
    src: 'usda', q: 'ref', cat: 'O', unit: 'g',
    kcal: pick('kcal') == null ? null : Math.round(pick('kcal')), kj: pick('kcal') == null ? null : Math.round(pick('kcal') * 4.184),
    p: r1(pick('p')), c: r1(pick('c')), f: r1(pick('f')), sat: r1(pick('sat')), sug: r1(pick('sug')), fib: r1(pick('fib')),
    na: na == null ? null : Math.round(na) / 1000, salt: na == null ? null : Math.round(na * 2.5) / 1000,
    portion: null, allergens: null, ingredients: x.ingredients ? String(x.ingredients).slice(0, 600) : null,
    updated: x.publishedDate || x.modifiedDate || null, dataType: x.dataType || null,
    license: 'Public Domain (CC0) – USDA FoodData Central',
  };
  return plausible(f) ? f : null;
}
async function fetchT(u, opt = {}, ms = 4500) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(u, { ...opt, signal: ac.signal, headers: { 'User-Agent': FOOD_UA, 'Accept': 'application/json', ...(opt.headers || {}) } }); }
  finally { clearTimeout(t); }
}
async function offSearch(q) {
  // 1. Search-a-licious (schnelle neue OFF-Suche), 2. Ersatz: klassische OFF-Suche
  let sal = null; const dbg = {};
  try {
    const r = await fetchT(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=de,en&page_size=50&fields=${OFF_FIELDS}`);
    dbg.sal = r.status;
    if (r.ok) { const j = await r.json(); const hits = j.hits || j.products || []; if (Array.isArray(hits)) { sal = hits.map(mapOFF).filter(Boolean); dbg.salRaw = hits.length; dbg.salOk = sal.length;
      // Treffer ohne Nährwerte im Suchindex: Nährwerte gesammelt in EINER Anfrage nachladen
      const miss = hits.filter((h) => h && h.code && !(h.nutriments && Object.keys(h.nutriments).length)).slice(0, 24).map((h) => h.code);
      if (miss.length && sal.length < 15) { try {
        const r2 = await fetchT(`https://world.openfoodfacts.org/api/v2/search?code=${miss.join(',')}&fields=${OFF_FIELDS}&page_size=24`, {}, 5000);
        dbg.fill = r2.status; if (r2.ok) { const j2 = await r2.json(); const add = (j2.products || []).map(mapOFF).filter(Boolean); const ord = new Map(miss.map((c, i) => [c, i])); add.sort((a, b) => (ord.get(a.ean) ?? 99) - (ord.get(b.ean) ?? 99)); sal = sal.concat(add); dbg.fillOk = add.length; }
      } catch (e) { dbg.fill = 'err'; } } } }
  } catch (e) { dbg.sal = 'err'; }
  if (sal && sal.length >= 6) return { list: sal, via: 'sal', dbg };
  // wenige/keine Treffer: zusätzlich die klassische Suche (deutscher Katalog zuerst)
  try {
    const r = await fetchT(`https://de.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=40&sort_by=unique_scans_n&fields=${OFF_FIELDS}`, {}, 7000);
    dbg.cgi = r.status; if (!r.ok) throw new Error('off ' + r.status);
    const j = await r.json(); const cgi = (j.products || []).map(mapOFF).filter(Boolean); dbg.cgiRaw = (j.products || []).length; dbg.cgiOk = cgi.length;
    return { list: (sal || []).concat(cgi), via: sal ? 'sal+cgi' : 'cgi', dbg };
  } catch (e) { if (dbg.cgi === undefined) dbg.cgi = 'err'; if (sal) return { list: sal, via: 'sal', dbg }; throw e; }
}
async function fdcSearch(q, env) {
  let key = env.FDC_API_KEY;
  if (!key) { // DEMO_KEY: höchstens 40 Anfragen pro Tag über alle Nutzer
    const k = 'fdc-' + new Date().toISOString().slice(0, 10);
    const row = await env.DB.prepare('SELECT v FROM counters WHERE k = ?').bind(k).first();
    if (row && row.v >= 40) return [];
    await env.DB.prepare('INSERT INTO counters (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1').bind(k).run();
    key = 'DEMO_KEY';
  }
  const r = await fetchT(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&dataType=${encodeURIComponent('Foundation,SR Legacy')}&pageSize=15`);
  if (!r.ok) return [];
  const j = await r.json(); return (j.foods || []).map(mapFDC).filter(Boolean);
}
const ENGLISHISH = /\b(chicken|beef|pork|rice|oats?|egg|eggs|milk|cheese|bread|apple|banana|potato|salmon|tuna|breast|raw|cooked|boiled|fried|butter|yogurt|beans?|peanut|almonds?|nuts?|turkey|fish|oil|sugar|flour|pasta|steak|bacon|ham|spinach|broccoli|avocado|whey|protein)\b/i;
function rankFood(list, q) {
  const words = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const hitN = new Map();
  const sc = (f) => { const n = (f.n + ' ' + (f.brand || '') + ' ' + (f.store || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let s = 0, h = 0; for (const w of words) { if (new RegExp('\\b' + w).test(n)) { s += 2; h++; } else if (n.includes(w)) { s += 1; h++; } else s -= 2; }
    hitN.set(f, h);
    if (f.de) s += 1.5; if (f.src === 'usda') s += 0.5; if (f.p != null && f.c != null && f.f != null) s += 0.5; if (f.sat != null && f.sug != null && f.salt != null) s += 0.3;
    s -= Math.min(1.5, f.n.length / 60); return s; };
  const seen = new Set(); const out = [];
  const need = words.length <= 1 ? 0 : words.length - 1; // bei mehreren Wörtern höchstens eins fehlen
  for (const f of list.map((f) => [sc(f), f]).sort((a, b) => b[0] - a[0]).map((x) => x[1])) {
    if (hitN.get(f) < need || (f.src === 'usda' && words.length && hitN.get(f) < Math.ceil(words.length / 2))) continue;
    const k = f.ean ? 'e' + f.ean : 'n' + f.n.toLowerCase() + '|' + (f.brand || '').toLowerCase() + '|' + f.kcal;
    const k2 = 'n' + f.n.toLowerCase().replace(/\s+/g, ' ') + '|' + (f.brand || '').toLowerCase() + '|' + f.kcal + '|' + Math.round(f.p || 0);
    if (seen.has(k) || seen.has(k2)) continue; seen.add(k); seen.add(k2); out.push(f);
  }
  return out;
}
async function foodSearch(req, env, url, ctx) {
  const q = String(url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (q.length < 2) return json(req, env, { ok: false, error: 'short' }, 400);
  if (url.searchParams.get('raw') === '1') { // Diagnose: Rohdaten der neuen OFF-Suche (öffentliche Daten)
    const r = await fetchT(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&langs=de,en&page_size=3&fields=${OFF_FIELDS}`);
    const j = await r.json(); const h = (j.hits || []).slice(0, 2).map((x) => ({ ...x, ingredients_text: undefined, ingredients_text_de: undefined }));
    return json(req, env, { ok: true, keys: Object.keys(j), hits: h, mapped: h.map(mapOFF) });
  }
  const cacheKey = new Request('https://food-cache.local/s/v4/' + encodeURIComponent(q.toLowerCase()));
  const cache = caches.default; const hit = await cache.match(cacheKey);
  if (hit) { const d = await hit.json(); return foodJson(req, env, { ...d, cached: true }); }
  if (!upOk(40)) return json(req, env, { ok: false, error: 'busy' }, 429);
  const t0 = Date.now();
  const useFdc = ENGLISHISH.test(q) || !!env.FDC_API_KEY;
  const [off, fdc] = await Promise.allSettled([offSearch(q), useFdc ? fdcSearch(q, env) : Promise.resolve([])]);
  const list = rankFood([...(off.status === 'fulfilled' ? off.value.list : []), ...(fdc.status === 'fulfilled' ? fdc.value : [])], q).slice(0, 40);
  const src = { off: off.status === 'fulfilled' ? off.value.via : 'error', dbg: off.status === 'fulfilled' ? off.value.dbg : String(off.reason && off.reason.message), usda: !useFdc ? 'skip' : fdc.status === 'fulfilled' ? 'ok' : 'error' };
  const d = { ok: true, q, n: list.length, ms: Date.now() - t0, src, items: list };
  if (off.status === 'fulfilled' || list.length) ctx && ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${list.length ? 259200 : 3600}` } })));
  else return json(req, env, { ok: false, error: 'upstream', src }, 502);
  return foodJson(req, env, d);
}
async function foodEan(req, env, code) {
  code = String(code).replace(/\D/g, '');
  if (code.length < 6 || code.length > 14) return json(req, env, { ok: false, error: 'code' }, 400);
  const row = await env.DB.prepare('SELECT ts, data FROM food_ean WHERE ean = ?').bind(code).first();
  const now = Date.now();
  if (row && now - row.ts < (row.data ? 30 : 3) * 864e5) return foodJson(req, env, { ok: true, cached: true, item: row.data ? JSON.parse(row.data) : null });
  if (!upOk(60)) return json(req, env, { ok: false, error: 'busy' }, 429);
  const r = await fetchT(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}&lc=de`);
  if (!r.ok && r.status !== 404) return json(req, env, { ok: false, error: 'upstream' }, 502);
  const j = await r.json(); const item = j.status === 1 ? mapOFF(j.product) : null;
  await env.DB.prepare('INSERT OR REPLACE INTO food_ean (ean, ts, data) VALUES (?, ?, ?)').bind(code, now, item ? JSON.stringify(item) : null).run();
  return foodJson(req, env, { ok: true, item });
}
const foodJson = (req, env, d) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...cors(req, env) } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    if (!env.DB) return json(req, env, { ok: false, error: 'no_db' }, 500);
    await ensureSchema(env.DB);
    try {
      if (url.pathname === '/' && req.method === 'GET') return new Response('Dr. Muskel Coach Server läuft', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(req, env) } });
      if (url.pathname === '/feedback' && req.method === 'POST') {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
        return await postFeedback(req, env);
      }
      if (url.pathname === '/e' && req.method === 'POST') {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
        return await postEvents(req, env);
      }
      if (url.pathname === '/code' && req.method === 'POST') {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
        return await redeem(req, env);
      }
      if (url.pathname.startsWith('/food/')) {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
      }
      if (url.pathname === '/food/search' && req.method === 'GET') return await foodSearch(req, env, url, ctx);
      const fe = url.pathname.match(/^\/food\/ean\/(\d{6,14})$/);
      if (fe && req.method === 'GET') return await foodEan(req, env, fe[1]);
      if (url.pathname.startsWith('/f/')) {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
        return await friends(req, env, url);
      }
      if (url.pathname.startsWith('/admin/')) {
        const a = await isAdmin(req, env);
        if (a === 'locked') return json(req, env, { ok: false, error: 'locked' }, 429);
        if (a !== 'ok') return json(req, env, { ok: false, error: 'unauthorized' }, 401);
        if (url.pathname === '/admin/feedback' && req.method === 'GET') return await adminList(req, env, url);
        if (url.pathname === '/admin/stats' && req.method === 'POST') return await adminStats(req, env);
        if (url.pathname === '/admin/import' && req.method === 'POST') return await adminImport(req, env);
        if (url.pathname === '/admin/code' && req.method === 'POST') return await adminCode(req, env);
        const m = url.pathname.match(/^\/admin\/feedback\/(\d+)$/);
        if (m && req.method === 'DELETE') { await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(Number(m[1])).run(); return json(req, env, { ok: true }); }
      }
      return json(req, env, { ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json(req, env, { ok: false, error: 'server' }, 500);
    }
  },
};
