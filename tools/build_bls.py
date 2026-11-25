#!/usr/bin/env python3
"""Baut aus dem Bundeslebensmittelschlüssel (BLS 4.0, MRI 2025) die App-Daten.

Ausgabe:
  lebensmittel-bls.json        – alle BLS-Lebensmittel (Referenzwerte, je 100 g)
  gerichte-schaetzwerte.json   – Imbiss-Gerichte, rechnerisch aus BLS-Zutaten (Schätzwerte)
  pruefbericht.json            – Zählung + Plausibilitätsprüfung
Aufruf: python3 build_bls.py <BLS_4_0_Daten_2025_DE.xlsx> <ausgabeordner>
"""
import sys, json, collections, datetime
import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True)
rows = list(wb.worksheets[0].iter_rows(values_only=True))
head = rows[0]

def col(prefix):
    for i, h in enumerate(head):
        s = str(h)
        if s.startswith(prefix + ' ') and 'Datenherkunft' not in s and 'Referenz' not in s:
            return i
    raise KeyError(prefix)

C = {k: col(k) for k in ['ENERCJ', 'ENERCC', 'PROT625', 'FAT', 'CHO', 'FIBT', 'SUGAR', 'FASAT', 'NACL', 'ALC']}

CATS = {
    'B': 'Brot & Brötchen', 'C': 'Getreide, Reis & Flocken', 'D': 'Kuchen, Kekse & Gebäck',
    'E': 'Eier & Nudeln', 'F': 'Obst', 'G': 'Gemüse', 'H': 'Hülsenfrüchte, Nüsse, Samen & Soja',
    'K': 'Kartoffeln & Pilze', 'M': 'Milch, Käse & Milchprodukte', 'N': 'Getränke (alkoholfrei)',
    'P': 'Alkoholische Getränke', 'Q': 'Fette & Öle', 'R': 'Gewürze, Saucen & Würzmittel',
    'S': 'Süßwaren, Zucker & Eis', 'T': 'Fisch & Meeresfrüchte', 'U': 'Fleisch',
    'V': 'Geflügel, Wild & Innereien', 'W': 'Wurst & Schinken', 'X': 'Gerichte & Rezepte',
    'Y': 'Gerichte & Mahlzeiten', 'Z': 'Imbiss & Fast Food (Schätzwerte)'}

def num(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def r1(v):
    return None if v is None else round(v, 1)

foods, by_code, seen_names = [], {}, collections.Counter()
issues = collections.Counter()
examples = collections.defaultdict(list)
for r in rows[1:]:
    code, de, en = str(r[0]).strip(), str(r[1]).strip(), (str(r[2]).strip() if r[2] else '')
    v = {k: num(r[i]) for k, i in C.items()}
    if not code or not de:
        issues['ohne Code/Name'] += 1
        continue
    seen_names[de.lower()] += 1
    # Plausibilität
    macro = sum(x or 0 for x in (v['PROT625'], v['FAT'], v['CHO'], v['FIBT'], v['ALC']))
    if macro > 101:
        issues['Makros > 100 g'] += 1; examples['Makros > 100 g'].append(de)
    calc = 4 * (v['PROT625'] or 0) + 4 * (v['CHO'] or 0) + 9 * (v['FAT'] or 0) + 2 * (v['FIBT'] or 0) + 7 * (v['ALC'] or 0)
    if v['ENERCC'] is not None and abs(calc - v['ENERCC']) > max(25, 0.15 * v['ENERCC']):
        issues['kcal weicht >15 % von Makro-Rechnung ab'] += 1
        examples['kcal weicht >15 % von Makro-Rechnung ab'].append(f"{de}: {v['ENERCC']} vs {round(calc)}")
    if any((x or 0) < 0 for x in v.values()):
        issues['negative Werte'] += 1
    row = [code, de, en, code[0],
           None if v['ENERCC'] is None else round(v['ENERCC']),
           None if v['ENERCJ'] is None else round(v['ENERCJ']),
           r1(v['PROT625']), r1(v['CHO']), r1(v['FAT']), r1(v['FASAT']),
           r1(v['SUGAR']), r1(v['FIBT']), None if v['NACL'] is None else round(v['NACL'], 2)]
    foods.append(row)
    by_code[code] = row

dups = [n for n, c in seen_names.items() if c > 1]
COLS = ['id', 'n', 'en', 'cat', 'kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt']
today = datetime.date.today().isoformat()
meta = {
    'source': 'Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut 2025',
    'citation': 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. Karlsruhe.',
    'license': 'Kostenfrei und ohne Lizenzbarrieren nutzbar, u. a. für App- und Softwareentwicklung (BLS-Doku Kap. 9.3). Quellenangabe empfohlen.',
    'url': 'https://blsdb.de', 'quality': 'ref', 'per': '100 g', 'built': today, 'cats': CATS}
json.dump({'meta': meta, 'cols': COLS, 'rows': foods}, open(f'{out}/lebensmittel-bls.json', 'w'),
          ensure_ascii=False, separators=(',', ':'))

# ---------- Schätz-Gerichte aus BLS-Zutaten ----------
SAUCE = [('M141300', 70), ('Q991000', 25), ('G490100', 5)]  # Joghurt, Mayonnaise, Knoblauch
RECIPES = [
    # name, aliases, portion_g (=Summe), Zutaten [(BLS-Code, g)]
    ('Knoblauchsoße / Dönersoße (Joghurt-Mayo)', 'knoblauchsosse doenersosse knoblauchsauce joghurtsosse weisse sosse', 30, SAUCE),
    ('Hamburger (Schätzung)', 'burger hamburger', None, [('B511000', 45), ('U010182', 35), ('R141100', 10), ('G480100', 5), ('G520100', 5)]),
    ('Cheeseburger (Schätzung)', 'cheeseburger cheese burger', None, [('B511000', 45), ('U010182', 35), ('M771600', 15), ('R141100', 10), ('G480100', 5), ('G520100', 5)]),
    ('Doppel-Cheeseburger (Schätzung)', 'doppelburger double cheeseburger doppelter', None, [('B511000', 45), ('U010182', 70), ('M771600', 30), ('R141100', 12), ('G480100', 5), ('G520100', 5)]),
    ('Baconburger (Schätzung)', 'bacon burger baconburger speckburger', None, [('B511000', 60), ('U010182', 110), ('M303700', 20), ('W415000', 15), ('R141100', 15), ('G103100', 10), ('G561100', 20)]),
    ('BBQ-Burger (Schätzung)', 'bbq burger barbecue', None, [('B511000', 60), ('U010182', 110), ('M303700', 20), ('X384143', 20), ('G480100', 15), ('G103100', 10)]),
    ('Smashburger (Schätzung)', 'smash burger smashburger', None, [('B511000', 60), ('U010182', 120), ('M303700', 25), ('Q991000', 15), ('G480100', 10), ('G520100', 10)]),
    ('Crispy-Chicken-Burger (Schätzung)', 'crispy chicken burger chickenburger knusper', None, [('B511000', 60), ('Y5A1000', 90), ('Q991000', 15), ('G103100', 15)]),
    ('Veggieburger (Schätzung)', 'veggie burger vegetarisch gemuese', None, [('B511000', 60), ('X5A1000', 90), ('R141100', 15), ('G103100', 15), ('G561100', 20)]),
    ('Dürüm Döner Hähnchen (Schätzung)', 'duerum yufka wrap doener rollo', None, [('B783012', 110), ('V422072', 130), ('G103100', 40), ('G561100', 30), ('G341100', 20), ('G480100', 15)] + [(c, g * 0.5) for c, g in SAUCE]),
    ('Dönerbox Hähnchen mit Pommes (Schätzung)', 'doenerbox doener box', None, [('K130492', 200), ('V422072', 150), ('G103100', 30)] + [(c, g * 0.5) for c, g in SAUCE]),
    ('Dönerteller Hähnchen mit Reis und Salat (Schätzung)', 'doenerteller doener teller', None, [('C352032', 200), ('V422072', 180), ('G103100', 60), ('G561100', 40), ('G341100', 30)] + [(c, g * 0.6) for c, g in SAUCE]),
    ('Pizza Salami (Schätzung)', 'pizza salami', None, [('X912033', 330), ('W140000', 40)]),
    ('Pizza Tonno (Schätzung)', 'pizza tonno thunfisch', None, [('X912033', 330), ('T121902', 60), ('G480100', 15)]),
    ('Pizza Hawaii (Schätzung)', 'pizza hawaii ananas', None, [('X912033', 330), ('W424000', 40), ('F501902', 50)]),
    ('Pizza Schinken (Schätzung)', 'pizza schinken', None, [('X912033', 330), ('W424000', 50)]),
]
names = {r[0]: r[1] for r in foods}
est_rows = []
for i, (name, alias, portion, ings) in enumerate(RECIPES):
    tot = sum(g for _, g in ings)
    acc = [0.0] * 9
    unknown = [False] * 9
    for code, g in ings:
        row = by_code[code]
        for k in range(9):
            val = row[4 + k]
            if val is None:
                unknown[k] = True
            else:
                acc[k] += val * g / 100
    per100 = [None if unknown[k] else acc[k] * 100 / tot for k in range(9)]
    p = portion or round(tot)
    est_rows.append({
        'id': f'est:{i + 1:03d}', 'n': name, 'cat': 'Z', 'alias': alias,
        'kcal': round(per100[0]), 'kj': round(per100[1]),
        'p': r1(per100[2]), 'c': r1(per100[3]), 'f': r1(per100[4]), 'sat': r1(per100[5]),
        'sug': r1(per100[6]), 'fib': r1(per100[7]), 'salt': None if per100[8] is None else round(per100[8], 2),
        'portion': {'g': p, 'label': '1 Portion'},
        'ings': [[c, round(g, 1), names[c]] for c, g in ings]})
json.dump({'meta': {
    'source': 'Rechnerische Schätzung aus BLS-4.0-Zutaten (eigene Rezeptur)', 'quality': 'est',
    'note': 'Schätzwerte – echte Gerichte variieren je nach Imbiss/Restaurant deutlich.', 'built': today},
    'rows': est_rows}, open(f'{out}/gerichte-schaetzwerte.json', 'w'), ensure_ascii=False, separators=(',', ':'))

cnt = collections.Counter(r[3] for r in foods)
report = {
    'datum': today,
    'bls_gesamt': len(foods),
    'schaetzgerichte': len(est_rows),
    'pro_kategorie': {f'{k} – {CATS[k]}': cnt[k] for k in sorted(cnt)},
    'doppelte_namen': len(dups), 'doppelte_namen_beispiele': dups[:10],
    'plausibilitaet': dict(issues),
    'plausibilitaet_beispiele': {k: v[:8] for k, v in examples.items()},
    'fehlende_werte': {c: sum(1 for r in foods if r[COLS.index(c)] is None) for c in COLS[4:]},
}
json.dump(report, open(f'{out}/pruefbericht.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(report, ensure_ascii=False, indent=1)[:3000])
