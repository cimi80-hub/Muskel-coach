#!/usr/bin/env python3
"""Baut foods_turkish.json – türkische Lebensmittel und Gerichte für Dr. Muskel Coach.

Datenquellen
  * Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut 2025 – frei nutzbar, auch für Apps.
  * Eigene Standardrezepte (tools/tr_rezepte.txt): Nährwerte = Summe der rohen BLS-Zutaten,
    umgerechnet über die Ausbeute (Gewicht gegart / roh; berücksichtigt Wasserverlust bzw. -aufnahme).
    → immer als „rezeptbasierte Schätzung“ gekennzeichnet.
  * TürKomp wird NICHT verwendet (kommerzielle Nutzung lizenzpflichtig, nicht abrufbar).

Aufruf: python3 tools/build_turkish.py <BLS-xlsx oder lebensmittel-bls.json>
"""
import json, re, sys, datetime, collections, unicodedata

src = sys.argv[1] if len(sys.argv) > 1 else 'lebensmittel-bls.json'
bls = json.load(open(src))
COLS = bls['cols']; BLS = {r[0]: dict(zip(COLS, r)) for r in bls['rows']}
N = ['kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt']

KEY = {  # Zutatenschlüssel → BLS-Code (Näherungen in Klammern dokumentiert)
 'mehl': 'C214200', 'mehl405': 'C214100', 'vkmehl': 'C211000', 'griess': 'C218000', 'bulgur': 'C119100', 'reis': 'C352000',
 'weizen': 'C111000', 'gerste': 'C148000', 'nudel': 'E401000', 'enudel': 'E432000', 'maismehl': 'C443000', 'staerke': 'C446000',
 'reismehl': 'C453000', 'linse': 'H725100', 'rlinse': 'H730000', 'kicher': 'G770400', 'wbohne': 'H739400', 'kidney': 'H742100',
 'bakla': 'H750100', 'lamm': 'U867100', 'lammk': 'U727100', 'lammbrust': 'U857100', 'lfett': 'U807100', 'lleber': 'V535100',
 'rind': 'U201000', 'rhack': 'U010100', 'kalb': 'U461100', 'pansen': 'V551100', 'huhn': 'V413000', 'hbrust': 'V416100',
 'hschenkel': 'V4A5100', 'hfluegel': 'V417100', 'ei': 'E111100', 'eigelb': 'E112100', 'milch': 'M111300', 'joghurt': 'M141300',
 'suzme': 'M141500', 'sahne': 'M173800', 'butter': 'Q611000', 'olivoel': 'Q120000', 'oel': 'Q320000', 'feta': 'M012200',
 'kasar': 'M400600', 'mozz': 'M032100', 'lor': 'M711100', 'kaymak': 'M7A6800', 'hellim': 'M524500', 'zwiebel': 'G480100',
 'fzwiebel': 'G482100', 'knobl': 'G490100', 'tomate': 'G561100', 'tmark': 'R160000', 'gpaprika': 'G541100', 'rpaprika': 'G543100',
 'acibiber': 'G553100', 'aubergine': 'G510100', 'zucchini': 'G582100', 'kartoffel': 'K110100', 'karotte': 'G620100',
 'spinat': 'G211100', 'weinblatt': 'G211100', 'kohl': 'G342100', 'gruenkohl': 'G322100', 'lauch': 'G470100', 'gbohne': 'G710100',
 'okra': 'G530100', 'erbse': 'G760100', 'blumenkohl': 'G311100', 'artischocke': 'G410100', 'gurke': 'G520100', 'salat': 'G105100',
 'rucola': 'G130100', 'petersilie': 'G250100', 'portulak': 'G460100', 'kuerbis': 'G581100', 'pilz': 'K701100', 'mais': 'G570100',
 'mais_korn': 'C341000', 'oliveng': 'H510802', 'olives': 'H520800', 'zitrone': 'F601600', 'walnuss': 'H120100', 'pistazie': 'H250100',
 'haselnuss': 'H130100', 'mandel': 'H210100', 'sesam': 'H420100', 'tahin': 'Q901000', 'pinien': 'H320100', 'rosine': 'F840100',
 'korinthe': 'F840300', 'aprikoseg': 'F201400', 'feigeg': 'F505400', 'kokos': 'H150400', 'erdnuss': 'H110600', 'zucker': 'S111000',
 'puderz': 'S111100', 'honig': 'S120000', 'pekmez': 'S157000', 'kakao': 'S711000', 'quitte': 'F140100', 'granat': 'F506100',
 'orangesaft': 'F603600', 'salz': 'R111000', 'wasser': 'N110000', 'wasser2': 'N110000', 'hefe': 'R459000', 'bruehe': 'X411243',
 'fbruehe': 'Y183013', 'sucuk': 'W145000', 'pastirma': 'W540000', 'sardelle': 'T104100', 'makrele': 'T107100', 'sardine': 'T105100',
 'brasse': 'T617100', 'barsch': 'T601100', 'forelle': 'T422100', 'lachs': 'T410100', 'tinten': 'T020100', 'garnele': 'T753100',
 'muschel': 'T792100', 'thun': 'T121100', 'blaetterteig': 'D072000', 'mayonnaise': 'Q991000', 'ketchup': 'R141100', 'sosis': 'W193000',
 'kaffeepulver': 'N410100', 'gans': 'V471100', 'rleber': 'V531100', 'tbakla': 'G730100', 'borulce': 'H702100', 'eiklar': 'E113100', 'margarine': 'Q400000', 'paniermehl': 'C214200', 'joghurt_light': 'M141200', 'putenbrust_koch': 'W561000', 'kirsche': 'F211100', 'hammel': 'U866100', 'keks': 'D630400', 'sauerk': 'F212100', 'apfel': 'F110100', 'aprikose': 'F201100', 'erdbeere': 'F301100', 'dattel': 'F504400', 'rotebete': 'G613100', 'sellerie': 'G660100', 'radieschen': 'G691100', 'rotkohl': 'G341100', 'tee': 'N630000', 'sonnenblumenkerne': 'H430100', 'erdnusscreme': 'H880200'}
APPROX = {'weinblatt': 'Weinblätter über Spinat angenähert', 'kaymak': 'Kaymak über Mascarpone angenähert',
          'sucuk': 'Sucuk über Rindersalami angenähert', 'pastirma': 'Pastırma über Rinder-Rauchfleisch angenähert',
          'barsch': 'Wolfsbarsch über Flussbarsch angenähert', 'feta': 'Beyaz peynir über Feta angenähert',
          'kasar': 'Kaşar über Schnittkäse 45 % angenähert', 'lor': 'Lor über körnigen Frischkäse angenähert',
          'pekmez': 'Pekmez = Traubendicksaft', 'suzme': 'Süzme yoğurt über Sahnejoghurt angenähert'}
FAT_KEYS = {'butter', 'oel', 'olivoel', 'lfett'}
for k, c in KEY.items():
    assert c in BLS, (k, c)

def tr_ascii(s):
    s = s.lower().replace('ı', 'i').replace('İ', 'i').replace('ğ', 'g').replace('ş', 's').replace('ç', 'c').replace('ö', 'o').replace('ü', 'u')
    s = unicodedata.normalize('NFD', s); s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return s
def slug(s): return re.sub(r'[^a-z0-9]+', '-', tr_ascii(s)).strip('-')

CAT = {'corba': 'Çorbalar – Suppen', 'kebap': 'Kebaplar – Kebab & Grill', 'doner': 'Döner & Fastfood', 'ev': 'Ev yemekleri – Hausmannskost',
       'kofte': 'Köfteler – Fleischbällchen', 'pilav': 'Pilavlar – Reis & Bulgur', 'manti': 'Mantı & Teigwaren', 'dolma': 'Dolmalar & Sarmalar',
       'zeytinyagli': 'Zeytinyağlılar', 'borek': 'Börek, Pide & Gözleme', 'hamur': 'Hamur işleri – Backwaren, Börek, Pide',
       'kahvalti': 'Kahvaltı – Frühstück', 'peynir': 'Peynirler – Käse', 'meze': 'Mezeler & Salatalar', 'balik': 'Balıklar – Fisch',
       'tatli': 'Tatlılar – Süßspeisen', 'icecek': 'İçecekler – Getränke', 'kuruyemis': 'Kuruyemiş – Nüsse & Snacks',
       'sarkuteri': 'Şarküteri – Wurst & Fleischprodukte', 'et': 'Et & Tavuk – Fleisch', 'obst': 'Meyveler – Obst',
       'gemuese': 'Sebzeler – Gemüse', 'temel': 'Temel gıdalar – Hülsenfrüchte, Getreide, Öle'}
UNITS = {  # Standardgewichte je Einheit (g bzw. ml) – Vorschläge
 'corba': {'teller': 250, 'schuessel': 300, 'el': 15}, 'ev': {'teller': 300, 'schuessel': 300, 'el': 20},
 'pilav': {'teller': 250, 'el': 20}, 'kebap': {'teller': 350}, 'kofte': {'teller': 300}, 'doner': {'teller': 400},
 'meze': {'el': 20, 'tl': 7, 'schuessel': 150}, 'dolma': {'stk': 30}, 'tatli': {'el': 20, 'tl': 7}, 'icecek': {'glas': 200},
 'kahvalti': {'el': 15, 'tl': 5, 'glas': 200}, 'peynir': {'scheibe': 30, 'el': 15}, 'balik': {'teller': 300},
 'kuruyemis': {'el': 10, 'handvoll': 30}, 'hamur': {}, 'temel': {'el': 10, 'tl': 4, 'glas': 200}, 'obst': {'schuessel': 150},
 'gemuese': {'schuessel': 150}, 'et': {}, 'sarkuteri': {'scheibe': 10}}
UNIT_LABEL = {'teller': '1 Teller', 'schuessel': '1 Schüssel', 'el': '1 EL', 'tl': '1 TL', 'glas': '1 Glas', 'stk': '1 Stück',
              'scheibe': '1 Scheibe', 'handvoll': '1 Handvoll'}

items, problems = [], []
def units_for(kat, pg, plabel):
    u = {'portion': [pg, plabel]}
    if re.search(r'stück|stange|zehe|kolben|filet|blatt|dose', plabel, re.I): u['stk'] = [pg, plabel]
    for k, g in UNITS.get(kat, {}).items():
        if k not in u and UNIT_LABEL[k].lower() != plabel.lower(): u[k] = [g, UNIT_LABEL[k]]
    return u

# ---------------------------------------------------------------- 1) Türkische Namen für BLS-Grundnahrungsmittel
seen_alias = {}
for line in open('tools/tr_aliases.txt', encoding='utf-8'):
    line = line.strip()
    if not line or line.startswith('#'): continue
    code, tr, alt, kat, pg, plabel = [x.strip() for x in line.split('|')]
    if code not in BLS: problems.append(('Alias ohne BLS-Code', code, tr)); continue
    b = BLS[code]
    if code in seen_alias:  # gleiches Lebensmittel: nur weiterer Name
        seen_alias[code]['alias'] += ' ' + tr_ascii(tr) + ' ' + alt; continue
    state = 'roh' if re.search(r'roh|çiğ', b['n'] + tr, re.I) else 'gegart' if re.search(r'gekocht|gegrillt|gebraten|haşlanmış|ızgara|pişmiş|fırın|közlenmiş|kavrulmuş|tava', b['n'] + tr, re.I) else None
    it = {'id': 'tr:' + slug(tr), 'type': 'bls', 'bls': code, 'tr': tr, 'de': b['n'], 'alias': tr_ascii(tr) + ' ' + alt,
          'kat': kat, 'katName': CAT.get(kat, kat), 'region': None, 'prep': None, 'state': state,
          'portion': {'g': float(pg), 'label': plabel}, 'units': units_for(kat, float(pg), plabel),
          'per100': {k: b[k] for k in N}, 'kcalPortion': None if b['kcal'] is None else round(b['kcal'] * float(pg) / 100),
          'source': f'BLS 4.0 ({code}: {b["n"]})', 'quality': 'verifiziert (BLS-Referenzwert)'}
    seen_alias[code] = it; items.append(it)

# ---------------------------------------------------------------- 2) Rezepte
recipes = []
for line in open('tools/tr_rezepte.txt', encoding='utf-8'):
    line = line.rstrip('\n')
    if not line.strip() or line.startswith('#') or 'SKIP' in line: continue
    p = [x.strip() for x in line.split('|')]
    kat, tr, de, region, pg, plabel, yld, ings, alias = p[:9]; flag = 'R' if 'R' in p[9:] else ''
    if not ings: continue
    recipes.append(dict(kat=kat, tr=tr, de=de, region=region or None, pg=float(pg), plabel=plabel, yld=float(yld),
                        ings=[(a.split(':')[0], float(a.split(':')[1])) for a in ings.split(',')], alias=alias, rest=(flag == 'R')))

computed = {}  # slug → per100
def ref_keys(r):
    s = slug(r['tr']); s2 = slug(re.sub(r'\s*\(.*?\)', '', r['tr']))
    return [s, s2]
by_ref = {}
for r in recipes:
    for k in ref_keys(r): by_ref.setdefault(k, r)

def calc(r, fat_factor=1.0):
    tot = {k: 0.0 for k in N}; unk = set(); raw = 0.0; notes = set()
    for key, g in r['ings']:
        if key.startswith('@'):
            sub = by_ref.get(key[1:])
            if sub is None: raise KeyError('Teilrezept fehlt: ' + key)
            v = computed.get(id(sub))
            if v is None: return None  # später erneut
        else:
            if key not in KEY: raise KeyError('Zutat fehlt: ' + key)
            v = BLS[KEY[key]]
            if key in APPROX: notes.add(APPROX[key])
            if fat_factor != 1.0 and key in FAT_KEYS: g = g * fat_factor
        raw += g
        for k in N:
            if v.get(k) is None: unk.add(k)
            else: tot[k] += v[k] * g / 100
    cooked = raw * r['yld']
    per100 = {k: (None if k in unk else round(tot[k] * 100 / cooked, 2 if k == 'salt' else 1)) for k in N}
    per100['kcal'] = None if per100['kcal'] is None else round(per100['kcal'])
    per100['kj'] = None if per100['kj'] is None else round(per100['kj'])
    return per100, sorted(notes), raw, cooked

pending = list(recipes)
for _ in range(10):
    rest = []
    for r in pending:
        res = calc(r)
        if res is None: rest.append(r); continue
        computed[id(r)] = res[0]; r['_res'] = res
    pending = rest
    if not pending: break
for r in pending: problems.append(('Teilrezept nicht auflösbar', r['tr'], ''))

seen_ids = set(it['id'] for it in items)
def add_recipe(r, per100, notes, raw, cooked, restaurant=False):
    tr = r['tr'] + (' (Restoran)' if restaurant else '')
    de = r['de'] + (' – Restaurant' if restaurant else '')
    iid = 'tr:' + slug(tr)
    if iid in seen_ids: problems.append(('Dublette übersprungen', tr, '')); return
    pg = round(r['pg'] * (1.25 if restaurant else 1))
    if per100['kcal'] is None or per100['kcal'] > 900 or sum((per100[k] or 0) for k in ('p', 'c', 'f')) > 100.5:
        problems.append(('unplausibel', tr, str(per100['kcal']))); return
    seen_ids.add(iid)
    ings = ', '.join(f"{g:g} g {(by_ref[k[1:]]['tr'] + ' (Teilrezept)') if k.startswith('@') else BLS[KEY[k]]['n']}" for k, g in r['ings'] if k != 'wasser2')
    items.append({'id': iid, 'type': 'rezept', 'tr': tr, 'de': de, 'alias': tr_ascii(tr) + ' ' + r['alias'] + (' restoran restaurant' if restaurant else ' ev yapimi hausgemacht'),
                  'kat': r['kat'], 'katName': CAT.get(r['kat'], r['kat']), 'region': r['region'],
                  'prep': 'restoran' if restaurant else 'ev', 'state': 'gegart' if r['yld'] != 1.0 else None,
                  'portion': {'g': pg, 'label': r['plabel']}, 'units': units_for(r['kat'], pg, r['plabel']),
                  'per100': per100, 'kcalPortion': round(per100['kcal'] * pg / 100),
                  'source': 'Rezeptbasierte Schätzung aus BLS-4.0-Zutaten (Standardrezept, Ausbeute ' + f"{r['yld']:g}" + ')' + (
                      '; Restaurant-Variante: Fettanteil ×1,5, Portion ×1,25' if restaurant else '') + ('; ' + '; '.join(notes) if notes else ''),
                  'quality': 'Schätzwert (rezeptbasiert)', 'recipe': ings})

for r in recipes:
    if '_res' not in r: continue
    per100, notes, raw, cooked = r['_res']
    add_recipe(r, per100, notes, raw, cooked)
    if r['rest']:
        res = calc(r, fat_factor=1.5)
        if res: add_recipe(r, res[0], res[1], res[2], res[3], restaurant=True)

# ---------------------------------------------------------------- Ausgabe
today = datetime.date.today().isoformat()
regions = sorted({it['region'] for it in items if it['region']})
out = {'meta': {
    'name': 'Türkische Lebensmitteldatenbank – Dr. Muskel Coach', 'built': today, 'version': 1,
    'sources': ['Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut 2025 – frei nutzbar, auch für Apps',
                'Eigene Standardrezepte (rezeptbasierte Schätzung, Ausbeute = Garverlust/Wasseraufnahme)'],
    'not_used': 'TürKomp (turkomp.tarimorman.gov.tr): Datensätze werden über Mitgliedschaft/Verkauf bereitgestellt – ohne Lizenz nicht für eine kostenpflichtige App verwendet.',
    'note': 'Nährwerte je 100 g. type=bls: türkischer Name für ein vorhandenes BLS-Lebensmittel (keine Dublette). type=rezept: Schätzwert.',
    'regions': regions}, 'items': items}
json.dump(out, open('foods_turkish.json', 'w'), ensure_ascii=False, separators=(',', ':'))
cnt = collections.Counter(it['type'] for it in items)
rep = {'datum': today, 'gesamt': len(items), 'bls_namen': cnt['bls'], 'rezepte': cnt['rezept'],
       'davon_restaurant_varianten': sum(1 for it in items if it['prep'] == 'restoran'),
       'pro_kategorie': dict(collections.Counter(it['katName'] for it in items)),
       'regionen': regions, 'anzahl_regionen': len(regions), 'probleme': problems}
json.dump(rep, open('turkish-pruefbericht.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: rep[k] for k in ('gesamt', 'bls_namen', 'rezepte', 'davon_restaurant_varianten', 'anzahl_regionen')}, ensure_ascii=False))
for pr in problems: print('PROBLEM', pr)
