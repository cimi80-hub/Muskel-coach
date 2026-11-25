# Prüfbericht Lebensmitteldatenbank – Dr. Muskel Coach

Stand: 2026-11-25

## Tatsächlich importiert (offline in der App)

| Quelle | Anzahl |
|---|---:|
| Bundeslebensmittelschlüssel 4.0 (MRI 2025) – Referenzwerte | **7.140** |
| Imbiss-Gerichte, aus BLS-Zutaten berechnet (als Schätzwert markiert) | 16 |
| Open Food Facts Markenprodukte (in DE verkauft, deutsche Produkte zuerst) | **25.000** |
| **Gesamt offline** | **32.156** |

Ziel „mindestens 10.000“ ist **erreicht**. Der Open-Food-Facts-Import lief am 2026-11-25 als GitHub Action über den kompletten Export.

## BLS pro Kategorie

| Kategorie | Anzahl |
|---|---:|
| B – Brot & Brötchen | 186 |
| C – Getreide, Reis & Flocken | 231 |
| D – Kuchen, Kekse & Gebäck | 466 |
| E – Eier & Nudeln | 104 |
| F – Obst | 275 |
| G – Gemüse | 560 |
| H – Hülsenfrüchte, Nüsse, Samen & Soja | 142 |
| K – Kartoffeln & Pilze | 157 |
| M – Milch, Käse & Milchprodukte | 279 |
| N – Getränke (alkoholfrei) | 114 |
| P – Alkoholische Getränke | 119 |
| Q – Fette & Öle | 65 |
| R – Gewürze, Saucen & Würzmittel | 97 |
| S – Süßwaren, Zucker & Eis | 253 |
| T – Fisch & Meeresfrüchte | 520 |
| U – Fleisch | 685 |
| V – Geflügel, Wild & Innereien | 462 |
| W – Wurst & Schinken | 375 |
| X – Gerichte & Rezepte | 1165 |
| Y – Gerichte & Mahlzeiten | 885 |

## Qualitätsprüfung

- Doppelte Namen: 0
- Fehlende Werte (werden in der App als „unbekannt“ angezeigt, nie als 0): p: 23, f: 28, sat: 23, fib: 53
- Plausibilität: kcal weicht >15 % von Makro-Rechnung ab: 12; Makros > 100 g: 1
  - Die Abweichungen betreffen Säuren, Zuckeralkohole und Süßstoffe (E 260, E 330, E 420 …) – dort ist die Abweichung fachlich korrekt (andere Energiefaktoren). Kein Fehler in den Daten.

## Funktionstests (automatisiert im Browser, Chrome)

- Suche: Döner/Doener, Hähnchenbrust (auch Tippfehler „Haenchenbrust“), Brokoli→Broccoli, Kartofeln→Kartoffel, Hüttenkäse→Körniger Frischkäse, Cola Zero, Basmatireis → richtige Treffer; ⌀ 11–24 ms pro Suche.
- Spracheingabe-Beispiele aus der Aufgabe korrekt erkannt: Hähnchendöner 350 g (Portionsvorschlag) + kleine Pommes 100 g; 250 g Reis gekocht + 230 g Putenbrust + 30 g Mandeln; Cheeseburger (Schätzung) + mittlere Pommes 150 g + 500 ml Cola Zero.
- Coach-Fragen: Eiweiß in Magerquark, Kalorien Döner, Vergleich Skyr/Magerquark, Tagesbilanz, Essensvorschlag, Wasser, Gewicht → korrekt beantwortet und gespeichert.
- Tagebuch, Vortag kopieren, Wasser, Gewicht, Ziele, Verlauf: ohne JavaScript-Fehler.
- Open-Food-Facts-Import mit echtem Export: 4.929.745 Produkte gelesen. 4.488.608 nicht in DE verkauft. 181.606 ohne vollständige Nährwerte. 4.049 unplausibel. 7.269 doppelt → 25.000 übernommen.
- Häufigste Marken: Aldi (1113), Edeka (780), Alnatura (704), dmBio (680), ja! (549), K-Classic (519), Milbona (397), REWE Bio (394), REWE Beste Wahl (378), Rewe (353), Lidl (352), DmBio (278), GUT&GÜNSTIG (231), Dr. Oetker (225), Vemondo (181), Kaufland (179), Gut & Günstig (168), BioBio (166), Milsani (158), Edeka Bio (153)
- Bekannte Schwäche: Manche Produkte heißen in der Sprache des Herstellers (z. B. Französisch bei Lidl-Importware), weil der Export nur einen Namen liefert. Barcode und Marke stimmen trotzdem.
- Suche mit 32.156 Lebensmitteln bei 4-fach gedrosselter CPU (≈ Mittelklasse-Handy): 8–70 ms; erster Start ca. 3 s, danach aus dem Gerätespeicher.
- Nicht getestet: echtes iPhone/Android, Kamera-Scanner, Mikrofon (nur am echten Gerät möglich).
