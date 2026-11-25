#!/usr/bin/env python3
"""Open-Food-Facts-Import für Dr. Muskel Coach.

Lädt den offiziellen CSV-Export von Open Food Facts (Stream, nichts wird komplett
im Speicher gehalten), filtert in Deutschland verkaufte Produkte mit vollständigen
Nährwerten, prüft Plausibilität, entfernt Duplikate und schreibt off-de.json.

Lizenz der Daten: Open Database License (ODbL) – © Open Food Facts contributors.
Die erzeugte off-de.json ist eine abgeleitete Datenbank und steht ebenfalls unter ODbL.

Aufruf:  python3 off_import.py [--max 25000] [--src URL_ODER_DATEI] [--out off-de.json]
"""
import argparse, csv, gzip, io, json, sys, datetime, urllib.request

URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz'
UA = 'DrMuskelCoach-Import/1.0 (GitHub Actions; https://cimi80-hub.github.io/Muskel-coach/)'

ap = argparse.ArgumentParser()
ap.add_argument('--max', type=int, default=25000)
ap.add_argument('--src', default=URL)
ap.add_argument('--out', default='off-de.json')
ap.add_argument('--report', default='off-pruefbericht.json')
a = ap.parse_args()

csv.field_size_limit(sys.maxsize)
if a.src.startswith('http'):
    raw = urllib.request.urlopen(urllib.request.Request(a.src, headers={'User-Agent': UA}), timeout=120)
else:
    raw = open(a.src, 'rb')
stream = io.TextIOWrapper(gzip.GzipFile(fileobj=raw) if a.src.endswith('.gz') else raw, encoding='utf-8', errors='replace')
reader = csv.DictReader(stream, delimiter='\t', quoting=csv.QUOTE_NONE)
HAS = set(reader.fieldnames or [])

def num(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None

stats = {'gelesen': 0, 'nicht_DE': 0, 'ohne_name': 0, 'unvollstaendig': 0, 'unplausibel': 0, 'doppelt': 0}
best = {}  # Duplikat-Schlüssel -> Datensatz (behält meistgescanntes)
by_code = set()
for r in reader:
    stats['gelesen'] += 1
    if 'en:germany' not in (r.get('countries_tags') or ''):
        stats['nicht_DE'] += 1; continue
    name = (r.get('product_name_de') or r.get('product_name') or '').strip()
    code = (r.get('code') or '').strip()
    if not name or not code.isdigit() or len(code) < 8:
        stats['ohne_name'] += 1; continue
    kcal = num(r.get('energy-kcal_100g')); kj = num(r.get('energy-kj_100g')) or num(r.get('energy_100g'))
    if kcal is None and kj is not None:
        kcal = kj / 4.184
    p, c, f = num(r.get('proteins_100g')), num(r.get('carbohydrates_100g')), num(r.get('fat_100g'))
    if kcal is None or p is None or c is None or f is None:
        stats['unvollstaendig'] += 1; continue
    sug, sat, fib, salt = num(r.get('sugars_100g')), num(r.get('saturated-fat_100g')), num(r.get('fiber_100g')), num(r.get('salt_100g'))
    calc = 4 * p + 4 * c + 9 * f + 2 * (fib or 0)
    bad = (kcal < 0 or kcal > 950 or min(p, c, f) < 0 or p + c + f > 101
           or (sug is not None and sug > c + 0.5) or (sat is not None and sat > f + 0.5)
           or (salt is not None and (salt < 0 or salt > 100))
           or (kcal > 40 and abs(calc - kcal) > max(40, 0.35 * kcal)))
    if bad:
        stats['unplausibel'] += 1; continue
    if code in by_code:
        stats['doppelt'] += 1; continue
    by_code.add(code)
    brand = (r.get('brands') or '').split(',')[0].strip()
    qty = (r.get('quantity') or '').lower()
    unit = 'ml' if any(qty.endswith(u) for u in (' ml', 'ml', ' l', ' cl', 'cl')) else 'g'
    scans = num(r.get('unique_scans_n')) or 0
    # Deutsche Produkte zuerst: Sprache Deutsch oder deutscher EAN-Präfix (400–440), danach nur in DACH verkaufte, dann Rest
    lc = (r.get('lc') or r.get('lang') or '').strip().lower()
    ctr = [c for c in (r.get('countries_tags') or '').split(',') if c]
    de_ean = len(code) == 13 and 400 <= int(code[:3]) <= 440
    tier = 0 if (lc == 'de' or de_ean) else 1 if all(c in ('en:germany', 'en:austria', 'en:switzerland') for c in ctr) else 2
    sq = num(r.get('serving_quantity'))
    rec = {
        'ean': code, 'n': name[:120], 'brand': brand[:60] or None, 'store': (r.get('stores') or '').strip()[:80] or None,
        'unit': unit, 'kcal': round(kcal), 'kj': round(kj) if kj is not None else round(kcal * 4.184),
        'p': round(p, 1), 'c': round(c, 1), 'f': round(f, 1),
        'sat': None if sat is None else round(sat, 1), 'sug': None if sug is None else round(sug, 1),
        'fib': None if fib is None else round(fib, 1), 'salt': None if salt is None else round(salt, 2),
        'pg': round(sq) if sq and 0 < sq < 2000 else None, 'pl': (r.get('serving_size') or '')[:40] or None,
        'all': ','.join(t.split(':')[-1] for t in (r.get('allergens_tags') or '').split(',') if t) or None,
        'upd': datetime.datetime.fromtimestamp(int(num(r.get('last_modified_t')) or 0), datetime.timezone.utc).date().isoformat(),
        '_s': scans, '_t': tier}
    key = (name.lower(), brand.lower(), rec['kcal'])
    old = best.get(key)
    if old is None or scans > old['_s']:
        if old is not None:
            stats['doppelt'] += 1
        best[key] = rec
    else:
        stats['doppelt'] += 1

rows = sorted(best.values(), key=lambda x: (x['_t'], -x['_s']))[:a.max]
stats['stufe_de'] = sum(1 for x in rows if x['_t'] == 0); stats['stufe_dach'] = sum(1 for x in rows if x['_t'] == 1); stats['stufe_rest'] = sum(1 for x in rows if x['_t'] == 2)
stats['spalten_lc'] = 'lc' in HAS or 'lang' in HAS
COLS = ['ean', 'n', 'brand', 'store', 'unit', 'kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt', 'pg', 'pl', 'all', 'upd']
today = datetime.date.today().isoformat()
out = {'meta': {
    'source': 'Open Food Facts – CSV-Export', 'url': 'https://world.openfoodfacts.org/data',
    'license': 'Open Database License (ODbL) 1.0 – https://opendatacommons.org/licenses/odbl/1-0/ ; Inhalte: Database Contents License',
    'attribution': '© Open Food Facts contributors', 'quality': 'mfr', 'per': '100 g bzw. 100 ml',
    'filter': 'Verkaufsland Deutschland, vollständige Nährwerte, plausibel; deutsche Produkte (Sprache/EAN 400–440) zuerst, dann meistgescannt', 'built': today},
    'cols': COLS, 'rows': [[r[c] for c in COLS] for r in rows]}
json.dump(out, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))
stats['exportiert'] = len(rows)
stats['datum'] = today
json.dump(stats, open(a.report, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(stats, ensure_ascii=False))
