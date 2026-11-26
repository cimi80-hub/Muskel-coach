/**
 * Dr. Muskel Coach – Feedback-Dienst (Cloudflare Worker + D1, kostenloses Kontingent)
 *
 * Bindings / Einstellungen im Cloudflare-Dashboard:
 *   D1-Datenbank  → Binding-Name  DB
 *   Secret        → ADMIN_KEY     (langes Passwort nur für dich; wird serverseitig geprüft)
 *   Secret        → SALT          (beliebige lange Zeichenfolge; anonymisiert IP-Adressen für den Spamschutz)
 *   Variable (opt.) ALLOWED_ORIGINS  z. B. "https://cimi80-hub.github.io"
 *
 * Gespeichert wird nur: Sterne, Name (freiwillig, sonst „Anonym“), Kommentar, Datum, App-Version, Sprache.
 * Keine IP-Adressen. Für den Spamschutz wird ein Einweg-Hash (IP + SALT + Tag) max. 48 h gehalten.
 */
const LIMIT_HOUR = 3;        // Einsendungen je Gerät/Netz pro Stunde
const LIMIT_DAY = 10;        // … pro Tag
const ADMIN_FAIL_LIMIT = 10; // falsche Admin-Versuche pro Stunde
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (env.ADMIN_KEY && env.ADMIN_KEY.length >= 12 && safeEqual(token, env.ADMIN_KEY)) return 'ok';
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    if (!env.DB) return json(req, env, { ok: false, error: 'no_db' }, 500);
    await ensureSchema(env.DB);
    try {
      if (url.pathname === '/' && req.method === 'GET') return new Response('Dr. Muskel Coach Feedback läuft', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(req, env) } });
      if (url.pathname === '/feedback' && req.method === 'POST') {
        const o = req.headers.get('Origin');
        if (o && !origins(env).includes(o)) return json(req, env, { ok: false, error: 'origin' }, 403);
        return await postFeedback(req, env);
      }
      if (url.pathname.startsWith('/admin/')) {
        const a = await isAdmin(req, env);
        if (a === 'locked') return json(req, env, { ok: false, error: 'locked' }, 429);
        if (a !== 'ok') return json(req, env, { ok: false, error: 'unauthorized' }, 401);
        if (url.pathname === '/admin/feedback' && req.method === 'GET') return await adminList(req, env, url);
        const m = url.pathname.match(/^\/admin\/feedback\/(\d+)$/);
        if (m && req.method === 'DELETE') { await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(Number(m[1])).run(); return json(req, env, { ok: true }); }
      }
      return json(req, env, { ok: false, error: 'not_found' }, 404);
    } catch (e) {
      return json(req, env, { ok: false, error: 'server' }, 500);
    }
  },
};
