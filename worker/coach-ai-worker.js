/* Muskel-Coach – KI-Helfer (Cloudflare Worker, kostenlos)
   Der Coach in der App fragt diesen Worker NUR, wenn seine Offline-Wissensbasis keine Antwort hat.
   Die API-Schlüssel liegen geheim in Cloudflare (nicht in der App, nicht auf GitHub).

   Geheime Variablen in Cloudflare (Settings › Variables and Secrets):
     GROQ_API_KEY    – kostenloser Schlüssel von console.groq.com   (optional, Anbieter 1)
     GEMINI_API_KEY  – kostenloser Schlüssel von aistudio.google.com (reicht allein; Ersatz wenn Groq ausfällt)
   Mindestens einer der beiden Schlüssel muss gesetzt sein.
   Optional (normale Variablen):
     GROQ_MODEL      – Standard: llama-3.3-70b-versatile
     GEMINI_MODEL    – Standard: gemini-flash-latest
     ALLOWED_ORIGIN  – Standard: https://cimi80-hub.github.io
*/

const LIMIT_PER_HOUR = 20;      // Fragen pro Nutzer (IP) und Stunde – schützt dein Gratis-Kontingent
const MAX_Q = 500;              // maximale Länge einer Frage
const hits = new Map();         // einfache Zählung (pro Worker-Instanz)

const SYSTEM = {
  de: `Du bist „Dr. Muskel Coach“, ein freundlicher Personal Trainer in einer Fitness-App.
Antworte auf Deutsch, kurz und praktisch: höchstens 4–5 Sätze, ohne Markdown, ohne Listen-Sternchen.
Themen: Krafttraining, Übungsausführung, Trainingsplanung, Ernährung, Regeneration, gängige Nahrungsergänzung.
Regeln: Keine Diagnosen und keine Dosierungen von Medikamenten, Anabolika, Hormonen oder Peptiden – verweise dafür auf einen Arzt.
Bei Schmerzen, Verletzungen, Vorerkrankungen oder Schwangerschaft: zum Arzt raten.
Wenn eine Frage nichts mit Fitness, Gesundheit oder Ernährung zu tun hat, sag freundlich, dass du nur dabei hilfst.`,
  en: `You are "Dr. Muskel Coach", a friendly personal trainer in a fitness app.
Answer in English, short and practical: at most 4–5 sentences, no markdown, no bullet asterisks.
Topics: strength training, exercise form, programming, nutrition, recovery, common supplements.
Rules: no diagnoses and no dosing of medication, steroids, hormones or peptides – refer to a doctor for that.
For pain, injuries, existing conditions or pregnancy: advise seeing a doctor.
If a question has nothing to do with fitness, health or nutrition, politely say you only help with that.`
};

function cors(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || 'https://cimi80-hub.github.io';
  return {
    'Access-Control-Allow-Origin': origin === allowed ? allowed : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });

function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= LIMIT_PER_HOUR) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

/* Beide Anbieter sprechen das OpenAI-Format – deshalb eine Funktion für alle */
async function ask(url, key, model, messages) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 350, temperature: 0.5 })
  });
  if (!r.ok) throw new Error(model + ' ' + r.status);
  const d = await r.json();
  const t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!t) throw new Error(model + ' leer');
  return t.replace(/\*\*?/g, '').trim();
}

/* Gemini direkt (eigenes Google-Format, Schlüssel im Header x-goog-api-key) */
async function askGemini(key, model, messages) {
  const sys = messages.find(m => m.role === 'system');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sys ? sys.content : '' }] }, contents, generationConfig: { maxOutputTokens: 400, temperature: 0.5 } })
  });
  if (!r.ok) throw new Error(model + ' ' + r.status);
  const d = await r.json();
  const parts = d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
  const t = parts && parts.map(p => p.text || '').join('');
  if (!t) throw new Error(model + ' leer');
  return t.replace(/\*\*?/g, '').trim();
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '', h = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return json({ ok: true, info: 'Muskel-Coach KI läuft' }, 200, h);
    if (h['Access-Control-Allow-Origin'] === 'null') return json({ error: 'origin' }, 403, h);

    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (limited(ip)) return json({ error: 'limit' }, 429, h);

    let body; try { body = await req.json(); } catch (e) { return json({ error: 'json' }, 400, h); }
    const q = String(body.q || '').trim().slice(0, MAX_Q);
    const lang = body.lang === 'en' ? 'en' : 'de';
    if (!q) return json({ error: 'leer' }, 400, h);

    const messages = [{ role: 'system', content: SYSTEM[lang] }];
    /* letzter Gesprächsverlauf (max. 6 Nachrichten) für Rückfragen */
    if (Array.isArray(body.hist)) for (const m of body.hist.slice(-6)) {
      if (m && (m.r === 'u' || m.r === 'a') && typeof m.t === 'string') messages.push({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t.slice(0, 600) });
    }
    messages.push({ role: 'user', content: q });

    const tries = [];
    if (env.GROQ_API_KEY) tries.push(() => ask('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, env.GROQ_MODEL || 'llama-3.3-70b-versatile', messages));
    if (env.GEMINI_API_KEY) tries.push(() => askGemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || 'gemini-flash-latest', messages));
    if (!tries.length) return json({ error: 'kein Schlüssel' }, 500, h);

    for (const t of tries) { try { return json({ a: await t() }, 200, h); } catch (e) { /* nächster Anbieter */ } }
    return json({ error: 'anbieter' }, 502, h);
  }
};
