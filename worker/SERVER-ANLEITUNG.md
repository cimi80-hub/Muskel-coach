# Eigener Server für Statistik & Feedback – Einrichtung (nur Handy, kostenlos)

Statistik-Zähler und Bewertungen werden in einer **Cloudflare D1-Datenbank** gespeichert. Ein kleiner **Cloudflare Worker** nimmt sie an und gibt sie nur mit deinem **Admin-Schlüssel** wieder heraus. Der Schlüssel liegt ausschließlich als verschlüsseltes „Secret“ bei Cloudflare – nie im App-Code.

Kostenlos (Free-Plan): 100.000 Worker-Aufrufe pro Tag, D1 mit 5 Mio. gelesenen / 100.000 geschriebenen Zeilen pro Tag und 5 GB Speicher. Ohne hinterlegte Zahlungsart können keine Kosten entstehen – bei Überschreitung gibt es bis Mitternacht (UTC) nur Fehler, die App läuft normal weiter.

## 1. Konto
1. Im Handy-Browser **dash.cloudflare.com** öffnen → mit E-Mail registrieren (kostenlos, keine Kreditkarte).

## 2. Datenbank anlegen
1. Menü ☰ → **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Name: `muskel-feedback` → **Create**. (Tabellen legt der Worker selbst an.)

## 3. Worker anlegen
1. Menü ☰ → **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World** (bzw. „Create Worker“).
2. Name: `muskel-coach-server` → **Deploy**.
3. **Edit code** → den gesamten Inhalt löschen → den Inhalt von `worker/muskel-worker.js` aus GitHub einfügen → **Deploy**.
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
Die Worker-Adresse öffnen, z. B. `https://muskel-coach-server.DEINNAME.workers.dev`
→ Es muss **„Dr. Muskel Coach Server läuft“** erscheinen.

## 7. Adresse an Claude schicken
Claude trägt sie als `API_URL` in `index.html` ein. Solange die Adresse leer ist, läuft alles wie bisher (Abacus) und die Feedback-Funktion ist unsichtbar.

## Statistik & Bewertungen ansehen
App → Logo 5× tippen → Entwickler-Passwort → oben **🔑 Server-Schlüssel** (= dein `ADMIN_KEY`) eingeben → **Verbinden**.
Danach kommen alle Statistiken mit **einer** Anfrage. Der letzte Stand erscheint sofort, oben steht „Zuletzt aktualisiert“ und die gemessene Ladezeit. Automatische Aktualisierung alle 30 Sekunden, 🔄 sofort.
Die Bewertungen stehen weiter unten unter **„⭐ Feedback & Bewertungen“**.
Der Schlüssel wird nur bis zum Schließen der App gemerkt (🔒 meldet sofort ab). Nach 10 falschen Versuchen pro Stunde sperrt der Server.

## Was gespeichert wird (Datenschutz)
- gespeichert: Sterne, Name (freiwillig, sonst „Anonym“), Kommentar, Datum/Uhrzeit, App-Version, Sprache
- **nicht** gespeichert: IP-Adresse, Gerät, Standort. Für die Sperre gegen Massen-Einsendungen wird nur ein täglich wechselnder, nicht umkehrbarer Hash genutzt und nach 48 Stunden gelöscht.
- Einzelne Bewertungen kannst du im Admin-Bereich löschen (z. B. auf Wunsch eines Nutzers).
- Empfehlung: in deiner Datenschutzerklärung einen Satz ergänzen: „Freiwilliges Feedback (Sterne, optionaler Name, Kommentar) wird über Cloudflare gespeichert und nur zur Verbesserung der App genutzt. Löschung auf Anfrage.“

## Spam-Schutz
Unsichtbares Lockfeld (Honeypot), Mindest-Ausfüllzeit, max. 2 Links, Herkunftsprüfung (nur deine App-Adresse), max. 3 Einsendungen pro Stunde und 10 pro Tag je Anschluss, in der App zusätzlich 60 Sekunden Wartezeit.

## Altdaten aus Abacus übernehmen (einmalig)
Entwicklerbereich → oben **„📥 Altdaten aus Abacus übernehmen“** → **Import starten**. Dauert einige Minuten (Abacus erlaubt nur ca. 30 Abfragen pro 10 Sekunden), App so lange geöffnet lassen.
Übernommen werden Gesamtzahlen, alle Tageswerte, Länder, Sicherheitsprotokoll und deine Codes. Der Import erhöht Werte nur (nie verringern, nie doppelt) – du kannst ihn gefahrlos wiederholen, z. B. wenn einzelne Zähler nicht lesbar waren.

## Übergangszeit und Rückfall
- Die App zählt in der Übergangszeit **parallel** weiter in Abacus (`USE_ABACUS=true` in `index.html`).
- Ist der Server nicht erreichbar, zeigt der Entwicklerbereich den letzten Stand mit Hinweis. Gibt es noch keinen gespeicherten Stand oder ist kein Schlüssel eingegeben, lädt er automatisch wie bisher aus Abacus.
- Komplett zurück: `API_URL` wieder leer setzen – alles ist dann exakt wie vorher.
- Nach stabiler Übergangszeit (2–4 Wochen): `USE_ABACUS=false` – dann zählt nur noch der eigene Server. Die Einmal-Prüfung der Verkaufs-Codes nutzt weiterhin zusätzlich den zweiten Zähldienst.
- Die Datenbank lässt sich im Cloudflare-Dashboard bis zu 7 Tage zurück wiederherstellen (Time Travel).

## Freunde & Gruppen
Läuft über denselben Server (Tabellen `fr_*`). Freiwillig: Nutzer aktivieren es selbst mit einem Spitznamen.
Geteilt werden nur Trainings-Eckdaten (Trainingstag, Dauer, Übungen, Sätze, bewegte Kilos, Rekorde). Kein Name, keine E-Mail, kein Körpergewicht, keine Ernährung.
Einladungen gelten 7 Tage, Gruppen max. 20 Personen, Aktivitäten werden nach 90 Tagen gelöscht. „Alle meine Daten löschen“ entfernt alles sofort.
Empfehlung für die Datenschutzerklärung: „Freunde & Gruppen (freiwillig): Spitzname und Trainings-Eckdaten werden über Cloudflare gespeichert und nur verbundenen Personen angezeigt. Löschung jederzeit in der App.“

## Server aktualisieren
Änderungen an `worker/` auf `main` werden automatisch über GitHub Actions („Server bereitstellen“) veröffentlicht.
