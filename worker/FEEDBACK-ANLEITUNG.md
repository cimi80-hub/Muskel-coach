# Feedback & Bewertung – Einrichtung (nur Handy, kostenlos)

Die Bewertungen werden in einer **Cloudflare D1-Datenbank** gespeichert. Ein kleiner **Cloudflare Worker** nimmt sie an und gibt sie nur mit deinem **Admin-Schlüssel** wieder heraus. Der Schlüssel liegt ausschließlich als verschlüsseltes „Secret“ bei Cloudflare – nie im App-Code.

Kostenlos (Free-Plan): 100.000 Worker-Aufrufe pro Tag, D1 mit 5 GB Speicher. Für Feedback reicht das um ein Vielfaches.

## 1. Konto
1. Im Handy-Browser **dash.cloudflare.com** öffnen → mit E-Mail registrieren (kostenlos, keine Kreditkarte).

## 2. Datenbank anlegen
1. Menü ☰ → **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Name: `muskel-feedback` → **Create**. (Tabellen legt der Worker selbst an.)

## 3. Worker anlegen
1. Menü ☰ → **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World** (bzw. „Create Worker“).
2. Name: `muskel-coach-feedback` → **Deploy**.
3. **Edit code** → den gesamten Inhalt löschen → den Inhalt von `worker/feedback-worker.js` aus GitHub einfügen → **Deploy**.
   (Auf GitHub die Datei öffnen → „Raw“ → alles markieren → kopieren.)

## 4. Datenbank verbinden
Worker öffnen → **Bindings** (oder Settings → Bindings) → **Add binding** → **D1 database**
- Variable name: `DB` (genau so, Großbuchstaben)
- Database: `muskel-feedback` → **Add/Deploy**

## 5. Geheimnisse hinterlegen
Worker → **Settings** → **Variables and Secrets** → **Add** → Typ **Secret**:
| Name | Wert |
|---|---|
| `ADMIN_KEY` | dein Admin-Schlüssel, **mindestens 12 Zeichen**, z. B. ein langes Passwort aus deinem Passwort-Manager |
| `SALT` | beliebige lange Zufallszeichen (nur für den Spam-Schutz, musst du dir nicht merken) |

Optional (Typ Text): `ALLOWED_ORIGINS` = `https://cimi80-hub.github.io` (ist ohnehin voreingestellt).

→ **Deploy**.

## 6. Testen
Die Worker-Adresse öffnen, z. B. `https://muskel-coach-feedback.DEINNAME.workers.dev`
→ Es muss **„Dr. Muskel Coach Feedback läuft“** erscheinen.

## 7. Adresse an Claude schicken
Claude trägt sie als `FEEDBACK_URL` in `index.html` ein und übernimmt die Funktion in die App. Solange die Adresse leer ist, ist die Feedback-Funktion unsichtbar.

## Bewertungen ansehen
App → Logo 5× tippen → Entwickler-Passwort → oben **„⭐ Feedback & Bewertungen“** → Admin-Schlüssel eingeben.
Der Schlüssel wird nur bis zum Schließen der App gemerkt (🔒 meldet sofort ab). Nach 10 falschen Versuchen pro Stunde sperrt der Server.

## Was gespeichert wird (Datenschutz)
- gespeichert: Sterne, Name (freiwillig, sonst „Anonym“), Kommentar, Datum/Uhrzeit, App-Version, Sprache
- **nicht** gespeichert: IP-Adresse, Gerät, Standort. Für die Sperre gegen Massen-Einsendungen wird nur ein täglich wechselnder, nicht umkehrbarer Hash genutzt und nach 48 Stunden gelöscht.
- Einzelne Bewertungen kannst du im Admin-Bereich löschen (z. B. auf Wunsch eines Nutzers).
- Empfehlung: in deiner Datenschutzerklärung einen Satz ergänzen: „Freiwilliges Feedback (Sterne, optionaler Name, Kommentar) wird über Cloudflare gespeichert und nur zur Verbesserung der App genutzt. Löschung auf Anfrage.“

## Spam-Schutz
Unsichtbares Lockfeld (Honeypot), Mindest-Ausfüllzeit, max. 2 Links, Herkunftsprüfung (nur deine App-Adresse), max. 3 Einsendungen pro Stunde und 10 pro Tag je Anschluss, in der App zusätzlich 60 Sekunden Wartezeit.
