# Prüfbericht Türkische Lebensmitteldatenbank (foods_turkish.json)

Stand: 2026-11-25

| | Anzahl |
|---|---:|
| **Einträge gesamt** | **1012** |
| Türkische Namen für vorhandene BLS-Lebensmittel (verifizierte Referenzwerte, keine Dubletten) | 228 |
| Gerichte als rezeptbasierte Schätzung | 784 |
| … davon Restaurant-Varianten (Fett ×1,5, Portion ×1,25) | 173 |
| Provinzen mit regionalen Spezialitäten | 70 von 81 |

## Pro Kategorie
| Kategorie | Anzahl |
|---|---:|
| Hamur işleri – Backwaren, Börek, Pide | 110 |
| Ev yemekleri – Hausmannskost | 110 |
| Kebaplar – Kebab & Grill | 101 |
| Tatlılar – Süßspeisen | 92 |
| Mezeler & Salatalar | 73 |
| Sebzeler – Gemüse | 56 |
| Çorbalar – Suppen | 56 |
| Kahvaltı – Frühstück | 50 |
| Balıklar – Fisch | 48 |
| Köfteler – Fleischbällchen | 47 |
| İçecekler – Getränke | 44 |
| Döner & Fastfood | 38 |
| Pilavlar – Reis & Bulgur | 35 |
| Kuruyemiş – Nüsse & Snacks | 33 |
| Temel gıdalar – Hülsenfrüchte, Getreide, Öle | 32 |
| Meyveler – Obst | 25 |
| Et & Tavuk – Fleisch | 22 |
| Peynirler – Käse | 18 |
| Dolmalar & Sarmalar | 15 |
| Şarküteri – Wurst & Fleischprodukte | 7 |

## Datenquellen und Lizenzen
- **BLS 4.0 (Max Rubner-Institut 2025):** frei nutzbar, auch kommerziell in Apps. Daraus stammen alle Zutatenwerte und die 228 „verifizierten“ Grundnahrungsmittel.
- **Rezeptbasierte Schätzung:** Für jedes Gericht gibt es ein Standardrezept (Zutaten roh in Gramm) mit Ausbeute-Faktor für Garverlust oder Wasseraufnahme. Nährwerte = Summe der Zutaten ÷ gegartes Gewicht. Gewürze unter 2 g werden nicht gezählt. Bei Sirup-Desserts wird eingekochtes Wasser berücksichtigt.
- **Näherungen sind im Eintrag genannt**, z. B. Weinblätter über Spinat, Beyaz peynir über Feta, Kaşar über Schnittkäse, Kaymak über Mascarpone, Sucuk über Rindersalami, Pastırma über Rinder-Rauchfleisch, Levrek über Flussbarsch.
- **TürKomp wurde nicht verwendet:** Die Datensätze werden über Firmen-Mitgliedschaft bzw. Verkauf bereitgestellt. Für eine kostenpflichtige App bräuchte man eine Lizenz. Die Seite war außerdem nicht abrufbar.
- Keine Werte sind als „verifiziert“ markiert, die nicht direkt aus dem BLS stammen.

## Regionen
Abgedeckt: Adana, Adıyaman, Afyon, Ağrı, Amasya, Ankara, Antalya, Artvin, Aydın, Balıkesir, Bolu, Burdur, Bursa, Çanakkale, Çorum, Denizli, Diyarbakır, Edirne, Elazığ, Erzincan, Erzurum, Eskişehir, Gaziantep, Giresun, Gümüşhane, Hatay, Isparta, Mersin, İstanbul, İzmir, Kars, Kastamonu, Kayseri, Kırklareli, Kırşehir, Kocaeli, Konya, Kütahya, Malatya, Manisa, Kahramanmaraş, Mardin, Muğla, Muş, Nevşehir, Niğde, Ordu, Rize, Sakarya, Samsun, Siirt, Sinop, Sivas, Tekirdağ, Tokat, Trabzon, Tunceli, Şanlıurfa, Uşak, Van, Yozgat, Aksaray, Bayburt, Batman, Bartın, Ardahan, Iğdır, Karabük, Kilis, Düzce.

Ohne eigene Spezialität (keine gesicherte Zuordnung): Bilecik, Bingöl, Bitlis, Çankırı, Hakkari, Zonguldak, Karaman, Kırıkkale, Şırnak, Yalova, Osmaniye.

## Prüfungen
- Plausibilität: kcal ≤ 900/100 g, Eiweiß + Kohlenhydrate + Fett ≤ 100 g/100 g. Abgelehnte oder übersprungene Einträge: 4 (Dublette übersprungen: Uskumru ızgara; Dublette übersprungen: Sardalya ızgara; Dublette übersprungen: Fıstık ezmesi; Dublette übersprungen: Sucuk (ızgara)).
- Dubletten: gleiche Namen werden übersprungen. Türkische Namen für BLS-Lebensmittel hängen am bestehenden Eintrag, statt ihn doppelt anzulegen.
- Suche getestet: Köfte, köfte, KÖFTE und kofte → gleiche Treffer; „mercimek corbasi“ = „Mercimek çorbası“; „elma“ → Apfel; „cig kofte“ → Çiğ köfte. Durchschnittlich 3 ms pro Suche.
- Spracheingabe getestet: „Ich hatte einen Teller Mercimek çorbası und 2 Lahmacun“, „bir tabak kuru fasulye ve bir kase pilav yedim“.
