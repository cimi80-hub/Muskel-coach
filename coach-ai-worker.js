/* Muskel-Coach – KI-Helfer (Cloudflare Worker, kostenlos)
   Der Coach in der App fragt diesen Worker NUR, wenn seine Offline-Wissensbasis keine Antwort hat.
   Die API-Schlüssel liegen geheim in Cloudflare (nicht in der App, nicht auf GitHub).

   Geheime Variablen in Cloudflare (Settings › Variables and Secrets):
     GROQ_API_KEY    – kostenloser Schlüssel von console.groq.com   (optional, Anbieter 1)
     GEMINI_API_KEY  – kostenloser Schlüssel von aistudio.google.com (reicht allein; Ersatz wenn Groq ausfällt)
   Mindestens einer der beiden Schlüssel muss gesetzt sein.
   Die KI-Stimme (Vorlesen) nutzt denselben GEMINI_API_KEY (Gemini-Sprachausgabe, Gratis-Kontingent).
   Optional (normale Variablen):
     GROQ_MODEL      – Standard: llama-3.3-70b-versatile
     GEMINI_MODEL    – Standard: gemini-flash-latest
     ALLOWED_ORIGIN  – Standard: https://cimi80-hub.github.io
     TTS_MODEL       – Standard: gemini-2.5-flash-preview-tts (Ersatz: gemini-3.1-flash-tts-preview)
*/

const LIMIT_PER_HOUR = 20;      // Fragen pro Nutzer (IP) und Stunde – schützt dein Gratis-Kontingent
const MAX_Q = 500;              // maximale Länge einer Frage
const hits = new Map();         // einfache Zählung (pro Worker-Instanz)
const TTS_PER_HOUR = 80;        // Vorlesen pro Nutzer (IP) und Stunde
const ttsHits = new Map();
const VOICES = ['Sulafat','Achird','Algieba','Charon','Puck','Kore','Leda','Aoede','Zephyr','Orus','Umbriel','Despina','Vindemiatrix','Gacrux','Enceladus','Iapetus','Schedar','Sadachbia','Zubenelgenubi','Callirrhoe'];
const STYLE = {
  de: 'Lies den folgenden Text auf Deutsch vor. Sprich warm, locker, freundlich und selbstsicher – wie ein vertrauter Personal Trainer, der mit einem guten Freund redet. Natürliches Tempo, entspannte Betonung, kein Roboter-Ton:\n\n',
  en: 'Read the following text aloud in English. Speak warmly, relaxed, friendly and confident – like a trusted personal trainer chatting with a good friend. Natural pace, easy intonation, never robotic:\n\n'
};

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

function limited(ip, map = hits, max = LIMIT_PER_HOUR) {
  const now = Date.now(), list = (map.get(ip) || []).filter(t => now - t < 3600e3);
  if (list.length >= max) { map.set(ip, list); return true; }
  list.push(now); map.set(ip, list);
  if (map.size > 5000) map.clear();
  return false;
}

/* KI-Stimme: Gemini-Sprachausgabe → rohes PCM (24 kHz, 16 Bit, mono) als Base64 */
async function speak(key, model, text, voice, lang) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: STYLE[lang] + text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
  });
  if (!r.ok) throw new Error(model + ' ' + r.status);
  const d = await r.json();
  const parts = (d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
  const p = parts.find(x => x.inlineData && x.inlineData.data);
  if (!p) throw new Error(model + ' kein Audio');
  const m = /rate=(\d+)/.exec(p.inlineData.mimeType || '');
  return { pcm: p.inlineData.data, rate: m ? +m[1] : 24000 };
}
async function ttsHandler(body, env, h, ip, ctx) {
  if (!env.GEMINI_API_KEY) return json({ error: 'kein Schlüssel' }, 500, h);
  const text = String(body.tts || '').trim().slice(0, 1200);
  const lang = body.lang === 'en' ? 'en' : 'de';
  const voice = VOICES.includes(body.voice) ? body.voice : 'Sulafat';
  if (!text) return json({ error: 'leer' }, 400, h);
  /* Cache: gleiche Antwort + Stimme wird nur einmal erzeugt (spart Kontingent, ist sofort da) */
  const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(voice + '|' + lang + '|' + text));
  const hash = [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('');
  const ck = new Request('https://tts-cache.muskel-coach/' + hash);
  const cache = caches.default;
  const hit = await cache.match(ck);
  if (hit) { const d = await hit.json(); return json(d, 200, h); }
  if (limited(ip, ttsHits, TTS_PER_HOUR)) return json({ error: 'limit' }, 429, h);
  const models = [env.TTS_MODEL || 'gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];
  for (const md of models) {
    try {
      const out = await speak(env.GEMINI_API_KEY, md, text, voice, lang);
      const res = new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } });
      ctx && ctx.waitUntil ? ctx.waitUntil(cache.put(ck, res.clone())) : await cache.put(ck, res.clone());
      return json(out, 200, h);
    } catch (e) { /* nächstes Modell */ }
  }
  return json({ error: 'anbieter' }, 502, h);
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
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '', h = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return json({ ok: true, info: 'Muskel-Coach KI läuft' }, 200, h);
    if (h['Access-Control-Allow-Origin'] === 'null') return json({ error: 'origin' }, 403, h);

    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    let body; try { body = await req.json(); } catch (e) { return json({ error: 'json' }, 400, h); }
    if (body && body.tts) return ttsHandler(body, env, h, ip, ctx);
    if (limited(ip)) return json({ error: 'limit' }, 429, h);

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
