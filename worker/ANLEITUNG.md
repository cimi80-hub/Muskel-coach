# KI für den Coach einschalten (kostenlos, ca. 10 Minuten)

Der Coach antwortet weiter zuerst **offline** aus seiner Wissensbasis.
Nur wenn er etwas nicht weiß, fragt er die KI (Groq, Ersatz: Google Gemini).
Die Schlüssel liegen geheim bei Cloudflare, also nicht in der App und nicht auf GitHub.

## 1. Kostenlosen Groq-Schlüssel holen
1. Öffne **console.groq.com** und melde dich an (Google-Konto geht).
2. Geh auf **API Keys**, dann **Create API Key**, und kopiere den Schlüssel (beginnt mit `gsk_`).

Optional als Ersatz: Auf **aistudio.google.com** einen Gemini-Schlüssel erstellen (**Get API key**).

## 2. Cloudflare-Worker anlegen
1. Öffne **dash.cloudflare.com** und leg ein kostenloses Konto an.
2. Geh auf **Workers & Pages**, dann **Create**, dann **Create Worker** (bzw. „Hello World“-Vorlage).
3. Gib ihm den Namen `muskel-coach-ki` und tipp auf **Deploy**.
4. Tipp auf **Edit code**, lösch alles und füge den kompletten Inhalt von `worker/coach-ai-worker.js` ein. Danach tipp auf **Deploy**.

## 3. Schlüssel geheim hinterlegen
1. Im Worker geh auf **Settings**, dann **Variables and Secrets**, dann **Add**.
2. Typ **Secret**, Name `GROQ_API_KEY`, als Wert deinen Groq-Schlüssel einfügen und speichern.
3. Optional: genauso `GEMINI_API_KEY` mit dem Gemini-Schlüssel anlegen.

## 4. Adresse an Claude schicken
Oben im Worker steht die Adresse, z. B. `https://muskel-coach-ki.DEINNAME.workers.dev`.
Wenn du sie im Browser öffnest, muss dort stehen: `Muskel-Coach KI läuft`.

Schick die Adresse an Claude. Er trägt sie in der App als `CO_AI_URL` ein, schreibt den Hinweis unter „Was ist neu“ und lädt das Update hoch.

## Gut zu wissen
- Pro Nutzer sind **20 KI-Fragen pro Stunde** erlaubt. Das schützt dein Gratis-Kontingent.
- Die KI-Antworten sind in der App mit „🌐 KI-Antwort – ohne Gewähr“ markiert.
- Die Frage geht an Groq bzw. Google. Name und Profildaten werden **nicht** mitgeschickt.
- Die KI verweigert Dosierungen von Medikamenten, Hormonen und Peptiden und verweist dafür auf einen Arzt.
- Die Gratis-Kontingente der Anbieter können sich ändern. Fällt Groq aus, springt Gemini ein. Fallen beide aus, sagt der Coach wie bisher „Dazu weiß ich noch nichts“.
