# Ernährung für Dr. Muskel Coach – Installation (nur mit dem Handy)

Die Ernährung ist eine **eigene Testseite** (`ernaehrung.html`). Deine `index.html` und alle Trainingsfunktionen bleiben unverändert.

## 1. Dateien hochladen (Safari → github.com → Repo `Muskel-coach`)

„Add file“ → „Upload files“ → diese 4 Dateien auswählen → „Commit changes“:

| Datei | Wofür |
|---|---|
| `ernaehrung.html` | die Testseite (Tracker, Suche, Barcode, Coach) |
| `food-engine.js` | Suche, Mengen-Erkennung, Coach-Wissen, Speicher |
| `lebensmittel-bls.json` | 7.140 Lebensmittel aus dem BLS 4.0 |
| `gerichte-schaetzwerte.json` | 16 Imbiss-Gerichte (Burger, Dürüm, Dönerbox …) als Schätzwerte |

Alle 4 müssen im **selben Ordner wie die index.html** liegen.

Testen: `https://cimi80-hub.github.io/Muskel-coach/ernaehrung.html` (1–2 Min. nach dem Hochladen).

## 2. Markenprodukte laden (für 10.000+ offline)

1. Im Repo „Add file“ → „Upload files“ → Ordner `tools` mit `off_import.py` hochladen.
   Geht der Ordner nicht: „Create new file“, als Namen `tools/off_import.py` tippen und den Inhalt einfügen.
2. Genauso `.github/workflows/lebensmittel-import.yml` anlegen („Create new file“, Namen genau so eintippen, Inhalt einfügen).
3. Reiter **Actions** → „Lebensmittel-Import (Open Food Facts)“ → **Run workflow**. Dauert ca. 15–40 Minuten.
4. Danach liegen `off-de.json` und `off-pruefbericht.json` im Repo. Die App lädt sie automatisch.
5. Wichtig: Ein Push durch die Action startet deinen Pages-Workflow nicht automatisch. Starte ihn danach einmal per „Run workflow“ (oder ändere irgendeine Datei).

Der Import läuft danach am 1. jedes Monats von selbst.

## 3. Später: Coach in der Haupt-App

Der Voice-Coach in `index.html` kann dasselbe Ernährungswissen nutzen. Dazu kommt **eine** Zeile vor `</body>`:

```html
<script src="food-engine.js"></script>
```

In der Coach-Funktion wird dann zuerst gefragt:

```js
const r = await DMCFood.answer(text);   // null = keine Ernährungsfrage
if (r) { sprich(r.text); return; }     // sonst normaler Coach
```

Den Einbau mache ich, sobald du mir die aktuelle `index.html` schickst.

## Rechtliches (wichtig, weil die App kostenpflichtig ist)

- **BLS 4.0**: frei nutzbar, auch für Apps. Quelle wird in der App unter „Ziele → Daten & Quellen“ genannt.
- **Open Food Facts**: Lizenz ODbL. Kommerzielle Nutzung ist erlaubt. Die abgeleitete `off-de.json` muss aber öffentlich und unter ODbL bleiben. Das ist sie, weil dein Repo öffentlich ist. Die Quellenangabe steht in der App. Dein eigener Code muss deshalb nicht offengelegt werden.
- Persönliche Einträge (Essen, Gewicht, Wasser) bleiben nur auf dem Gerät des Nutzers (IndexedDB) und sind getrennt von den Produktdaten gespeichert.
- Ich bin kein Anwalt. Bevor du verkaufst, ist ein kurzer Blick auf die ODbL-Seite von Open Food Facts sinnvoll.
