#!/usr/bin/env python3
"""Baut restaurants.json – Fastfood-/Restaurant-Datenbank für Dr. Muskel Coach.

Nur Herstellerangaben aus offiziellen deutschen Nährwerttabellen (bzw. eindeutig
auf diese zurückgeführte Übernahmen). Nichts wird erfunden: fehlende Werte = null.
Jede Zeile wird geprüft (Kalorien ↔ Eiweiß/Kohlenhydrate/Fett); unstimmige Zeilen
werden NICHT übernommen, sondern im Prüfbericht aufgeführt.

Aufruf: python3 tools/build_ketten.py  → restaurants.json + ketten-pruefbericht.json
"""
import json, re, datetime, collections

def n(x):
    x = (x or '').strip().replace(',', '.').replace(' g', '').replace(' ml', '')
    if x in ('', '-', '–'): return None
    if x.startswith('<'): return 0.0  # „<0,1“ etc. → praktisch 0
    try: return float(x)
    except ValueError: return None

items, rejected = [], []

def add(chain, cat, name, portion, unit, per_portion, per100, source, stand, alias='', variant=None):
    """per_portion/per100: dict kcal,kj,p,c,f,sat,sug,fib,salt (None = unbekannt)."""
    K = ['kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt']
    pp = {k: (per_portion or {}).get(k) for k in K}
    ph = {k: (per100 or {}).get(k) for k in K}
    if portion and portion > 0:
        for k in K:  # fehlende 100-g-Werte aus Portion rechnen (und umgekehrt)
            if ph[k] is None and pp[k] is not None: ph[k] = pp[k] * 100 / portion
            if pp[k] is None and ph[k] is not None: pp[k] = ph[k] * portion / 100
    # Plausibilität (pro Portion, sonst pro 100)
    chk = pp if pp['kcal'] is not None else ph
    if chk['kcal'] is None:
        rejected.append((chain, name, 'keine Kalorien')); return
    if None not in (chk['p'], chk['c'], chk['f']):
        calc = 4 * chk['p'] + 4 * chk['c'] + 9 * chk['f'] + 2 * (chk['fib'] or 0)
        if chk['kcal'] > 20 and abs(calc - chk['kcal']) > max(25, 0.2 * chk['kcal']):
            rejected.append((chain, name, f"kcal {chk['kcal']:.0f} ≠ Makros {calc:.0f}")); return
        if chk['p'] + chk['c'] + chk['f'] > (portion or 100) * 1.02 and portion:
            rejected.append((chain, name, 'Makros > Portionsgewicht')); return
    def r(v, d=1): return None if v is None else round(v, d)
    rec = {
        'n': name, 'brand': chain, 'grp': cat, 'unit': unit,
        'kcal': r(ph['kcal'], 0), 'kj': r(ph['kj'], 0), 'p': r(ph['p']), 'c': r(ph['c']), 'f': r(ph['f']),
        'sat': r(ph['sat']), 'sug': r(ph['sug']), 'fib': r(ph['fib']), 'salt': r(ph['salt'], 2),
        'pg': portion, 'pk': r(pp['kcal'], 0), 'src': source, 'stand': stand, 'alias': alias}
    if unit == 'portion':  # Gewicht unbekannt: Werte gelten je 1 Portion (intern als „100 Einheiten“)
        rec.update({k: (r(pp[k], 2 if k == 'salt' else (0 if k in ('kcal', 'kj') else 1))) for k in K})
        rec['pg'] = None
    items.append(rec)

# ------------------------------------------------------------------ KFC (offiziell)
KFC_SRC = 'KFC Deutschland – „Allergene & Zusatzinformationen“ (static.kfc.de/pdf/ALLERGENE.pdf)'
KFC_STAND = '10/2026'
KFC_ALIAS = 'kfc kentucky fried chicken'
# Produkt;Portion;kJ_P;kcal_P;kJ_100;kcal_100;Fett_P;Fett_100;ges_P;ges_100;KH_P;KH_100;Zucker_P;Zucker_100;Eiweiss_P;Eiweiss_100;Salz_P;Salz_100
KFC = """
Hähnchen|Original Hähnchenteil Brust|110;981;234;893;213;12;11;4;3;9;8;1;0;23;21;1,8;1,7
Hähnchen|Original Hähnchenteil Unterkeule|52;508;122;972;233;7;13;2;4;4;7;0;0;11;21;0,8;1,5
Hähnchen|Original Hähnchenteil Oberkeule|97;1101;264;1134;272;18;18;6;6;11;11;1;1;16;16;1,6;1,6
Hähnchen|Original Hähnchenteil Rippe|128;1312;315;1022;245;18;14;6;5;12;9;1;0;26;20;1,7;1,3
Hähnchen|Original Hähnchenteil Flügel|89;1025;245;1153;276;13,8;15,5;3;3,5;8,9;10;0;0;21,4;24,1;1,3;1,4
Hähnchen|Hot Wings Oberflügel (1 Stück)|31;418;100;1339;322;7;22;2;7;4;12;0;0;6;19;0,7;2,1
Hähnchen|Hot Wings Unterflügel (1 Stück)|21;275;66;1303;312;4;21;1;7;2;11;0;0;4;19;0,4;1,8
Hähnchen|Original Bites (1 Stück)|25;241;58;980;234;3;12;1;4;3;13;0;0;5;19;0,6;2,5
Hähnchen|Crispys Original Chicken (1 Stück)|41;406;97;1001;240;5;14;2;4;4;10;0;1;8;19;0,5;1,3
Hähnchen|Zinger Chicken|91;943;226;1036;248;12;14;4;5;8;9;0;1;20;23;1;1
Burger|Kentucky BBQ Original Burger|238;2186;521;921;220;21;9;6;3;53;22;13;5;29;12;3,9;1,7
Burger|Kentucky BBQ Zinger Burger|233;2170;518;933;223;21;9;7;3;51;22;13;6;29;13;3;1,3
Burger|Double Kentucky BBQ Original Burger|345;3304;789;958;229;36;10;12;4;63;18;14;4;51;15;6,4;1,9
Burger|Double Kentucky BBQ Zinger Burger|335;3272;782;977;233;37;11;13;4;59;18;14;4;52;16;4,6;1,4
Burger|Classic Original Burger|205;2071;494;1010;241;21;10;5;2;48;23;6;3;26;13;3;1,5
Burger|Classic Zinger Burger|200;2055;490;1027;245;22;11;5;3;46;23;6;3;27;13;2,1;1,1
Burger|Classic Veggie Burger|191;1813;433;949;226;18;9;2;1;48;25;6;3;16;9;2,1;1,1
Burger|Colonel Original Burger|243;2373;567;979;234;28;11;7;3;49;20;9;4;29;12;3,6;1,5
Burger|Colonel Veggie Burger|229;2115;506;926;221;24;11;4;2;50;22;9;4;19;8;2,7;1,2
Burger|Double Colonel Burger|339;3332;797;984;235;40;12;11;3;59;17;10;3;49;14;5,7;1,7
Burger|Cheese & Bacon Burger|239;2483;593;1041;249;29;12;10;4;47;20;8;3;34;14;4;1,7
Burger|Double Cheese & Bacon Burger|346;3601;861;1041;249;44;13;16;5;57;17;9;3;56;16;6,5;1,9
Burger|Original Cheese Burger|226;2218;530;984;235;24;11;9;4;47;21;8;4;29;13;3,8;1,7
Burger|Zinger Cheese Burger|221;2202;526;999;239;24;11;9;4;45;20;8;4;30;14;2,9;1,3
Burger|Double Crispy Classic Burger|167;1673;399;1002;239;18;11;2;1;38;23;4;2;20;12;2,2;1,3
Burger|Crispy Cheese Burger|116;1167;277;1006;239;9;8;2;2;36;31;5;5;13;11;1,9;1,6
Burger|Crispy Chili Cheese Burger|116;1382;329;1192;283;16;14;1;1;34;29;4;4;12;11;1,7;1,5
Wraps|Twister / Crispy Twister|223;1812;433;812;194;19;9;3;1;42;19;3;1;21;9;2,3;1
Wraps|Veggie Twister|224;1745;417;779;186;18;8;2;1;45;20;3;1;16;7;2,2;1
Veggie|Veggie Tender (1 Stück)|41;351;84;855;205;4;10;1;1;5;13;0;0;5;12;0,6;1,4
Salate|Veggie Tender Salad ohne Dressing|279;887;213;318;76;9;3;0;0;17;6;5;2;12;4;1,2;0,4
Salate|Original Bites Salad ohne Dressing|296;1151;275;389;93;12;4;4;1;19;6;5;2;20;7;2,5;0,9
Salate|KFC Salad ohne Dressing|197;186;45;94;23;1;0;3;0;6;3;5;2;2;1;0,1;0
Beilagen|Halber Maiskolben|125;588;139;470;111;3;2;0;0;24;20;3;2;5;4;0;0
Beilagen|Kartoffelpüree mit Gravy|200;466;112;233;56;1;1;0;0;23;11;1;1;3;2;1,1;0,6
Beilagen|Kartoffelpüree|170;410;99;241;58;1;1;0;0;20;12;1;1;3;2;0,8;0,5
Beilagen|Gravy|30;56;13;187;44;0;0;0;0;2;8;0;1;0;2;0,3;1,1
Extras|Cheese Extra (1 Scheibe)|12;159;38;1380;333;3;26;0;0;0;4;0;4;0;20;0,4;3,8
Extras|Bacon Extra (2 Scheiben)|16;266;64;1661;400;5;31;2;12;0;1;0;1;5;30;0,2;1,4
Pommes|Original Pommes frites klein|108;999;239;925;221;11;10;1;1;30;28;0;0;3;3;0,5;0,5
Pommes|Original Pommes frites groß|157;1452;347;925;221;16;10;2;1;44;28;0;0;4;3;0,7;0,5
Pommes|Cheese Fries|207;1986;475;959;229;24;11;8;4;59;29;3;1;9;4;2,6;1,3
Pommes|Cheese & Bacon Fries|222;2272;544;1024;245;30;13;10;5;60;27;3;1;12;5;2,9;1,3
Eis|Softeis Sundae ohne Sauce|100;524;125;524;125;5;5;3;3;18;18;16;16;3;3;0,1;0,1
Eis|Softeis Sundae Toffee|120;763;181;636;151;5;4;4;3;31;26;29;24;3;3;0,1;0,1
Eis|Softeis Sundae Strawberry|120;706;168;588;140;5;4;3;3;28;24;25;21;3;2;0,1;0,1
Eis|Softeis Sundae Schokolade|113;1018;244;849;203;13;11;5;4;28;23;24;20;4;3;0,1;0,1
Eis|Softeis Sundae Mini ohne Sauce|55;288;69;524;125;3;5;2;3;10;18;9;16;2;3;0,1;0,1
Milchshakes|Toffee Milkshake 0,3 l|300;1908;454;636;151;12;4;9;3;78;26;73;24;8;3;0,3;0,1
Milchshakes|Toffee Milkshake 0,5 l|500;3157;751;631;150;21;4;15;3;128;26;119;24;13;3;0,5;0,1
Milchshakes|Strawberry Milkshake 0,3 l|300;1765;420;588;140;12;4;8;3;71;24;63;21;7;2;0,3;0,1
Milchshakes|Strawberry Milkshake 0,5 l|500;2928;696;586;139;19;4;14;3;117;23;104;21;12;2;0,5;0,1
Milchshakes|Schoko Milkshake 0,3 l|300;1961;469;654;156;21;7;11;4;60;20;53;18;9;3;0,3;0,1
Milchshakes|Schoko Milkshake 0,5 l|500;3263;780;653;156;36;7;18;4;100;20;87;17;14;3;0,5;0,1
Kaffee|Latte Macchiato|300;439;110;146;37;3;1;2;1;11;4;11;4;8;3;0,3;0,1
Kaffee|Cappuccino|300;390;98;130;33;3;1;2;1;10;3;10;3;7;2;0,3;0,1
Kaffee|Milchkaffee|300;292;74;98;24;2;1;2;0;7;2;7;2;5;2;0,2;0,1
Kaffee|Café Crema|285;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
Kaffee|Espresso|50;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0
Getränke|Pepsi 0,3 l|300;234;54;78;18;0;0;0;0;14;5;14;5;0;0;0;0
Getränke|Pepsi 0,4 l|400;312;72;78;18;0;0;0;0;18;5;18;5;0;0;0;0
Getränke|Pepsi 0,5 l|500;390;90;78;18;0;0;0;0;23;5;23;5;0;0;0,1;0
Getränke|Mirinda Orange 0,3 l|300;480;114;160;38;0;0;0;0;28;9;28;9;0;0;0,1;0
Getränke|Mirinda Orange 0,4 l|400;640;152;160;38;0;0;0;0;38;9;38;9;0;0;0,1;0
Getränke|Mirinda Orange 0,5 l|500;800;190;160;38;1;0;0;0;47;9;47;9;1;0;0,1;0
Getränke|7 Up Free 0,3 l|300;8;2;3;1;0;0;0;0;0;0;0;0;0;0;0,1;0
Getränke|7 Up Free 0,4 l|400;10;2;3;1;0;0;0;0;0;0;0;0;0;0;0,2;0
Getränke|7 Up Free 0,5 l|500;13;3;3;1;0;0;0;0;0;0;0;0;1;0;0,2;0
Getränke|Schwip Schwap Zero Orange 0,3 l|300;15;3;5;1;0;0;0;0;0;0;0;0;0;0;0,1;0
Getränke|Schwip Schwap Zero Orange 0,4 l|400;20;4;5;1;0;0;0;0;0;0;0;0;0;0;0,1;0
Getränke|Schwip Schwap Zero Orange 0,5 l|500;25;5;5;1;0;0;0;0;0;0;0;0;0;0;0,1;0
Getränke|Lift Apfelschorle 0,3 l|300;315;75;105;25;0;0;0;0;18;6;17;6;0;0;0;0
Getränke|Lift Apfelschorle 0,4 l|400;420;100;105;25;0;0;0;0;24;6;24;6;0;0;0;0
Getränke|Lift Apfelschorle 0,5 l|500;525;125;105;25;0;0;0;0;30;6;29;6;0;0;0;0
Getränke|Punica Apfelschorle 0,3 l|300;321;75;107;25;0;0;0;0;18;6;17;6;0;0;0;0
Getränke|Punica Apfelschorle 0,4 l|400;428;100;107;25;0;0;0;0;24;6;23;6;0;0;0;0
Getränke|Punica Apfelschorle 0,5 l|500;535;125;107;25;1;0;0;0;31;6;29;6;1;0;0,1;0
"""
LIQ = re.compile(r'(Milkshake|Latte|Cappuccino|Kaffee|Café|Espresso|Pepsi|Mirinda|7 Up|Schwip|Schorle|Dew|Mezzo|Lipton|Capri|Red Bull|Wasser|Mineralwasser|Acqua|Pellegrino|Tee|Cola|Fanta|Sprite|Saft)', re.I)
for line in KFC.strip().splitlines():
    cat, name, vals = line.split('|')
    v = [n(x) for x in vals.split(';')]
    por = v[0]
    pp = dict(kj=v[1], kcal=v[2], f=v[5], sat=v[7], c=v[9], sug=v[11], p=v[13], salt=v[15])
    ph = dict(kj=v[3], kcal=v[4], f=v[6], sat=v[8], c=v[10], sug=v[12], p=v[14], salt=v[16])
    add('KFC', cat, name, por, 'ml' if LIQ.search(name) else 'g', pp, ph, KFC_SRC, KFC_STAND, KFC_ALIAS)

# Verpackte Artikel (nur je 100 g/ml angegeben) – Produkt;Füllmenge;kJ_100;kcal_100;Fett;ges;KH;Zucker;Eiweiß;Salz
KFC_PACK = """
Saucen|Heinz Tomato Ketchup (Portion)|17;435;102;0,1;<0,1;23,2;22,8;1,2;1,8
Saucen|Heinz Salat Mayonnaise (Portion)|17;2269;551;58;4,5;6;4,4;0,9;1,9
Saucen|Heinz Pommes Frites Sauce (Portion)|17;1523;369;35;2,7;12;8,8;0,2;1,9
Saucen|Heinz Creamy Curry Dip|23;1674;405;36;3;19;11;0,66;2,03
Saucen|Smokey BBQ Dip|25;654;154;<0,5;<0,1;37;32;<0,5;2,4
Saucen|Spicy Creamy Dip|23;1969;477;47;4,9;11;8,5;1;1,4
Saucen|Garlic Sauce Dip|23;1426;345;31;2,6;16;7,8;0,9;1,6
Saucen|Original Dip|23;1598;387;37;3,2;12;6,4;0,6;1,7
Saucen|Sweet & Sour Dip|23;607;143;1,1;<0,1;33;29;<0,5;1,3
Dressings|Balsamico Dressing|75;376;89;3,3;0,2;13,1;13,1;0,2;3,3
Dressings|Joghurt Dressing|75;874;211;20;1,8;6,3;4,1;1,1;1,3
Dressings|French Dressing|75;787;190;15,8;1,3;10,5;7,7;0,6;2
Desserts|Double Chocolate Cookie|72;2009;480;23;14;61;38;5;0,5
Desserts|Chocolate Cookie|72;2048;489;23;14;64;39;4,9;0,5
Beilagen|Coleslaw|150;628;151;11;1;11;10;0,9;0,8
Extras|Butter (Portion)|10;3056;743;82;53;0,6;0,6;0,7;<0,01
Getränke|Pepsi Zero Zucker Einweg 0,5 l|500;2;0,5;0;0;0;0;0;0,01
Getränke|Pepsi Einweg 0,5 l|500;78;18;0;0;4,6;4,6;0;<0,01
Getränke|Mountain Dew Einweg 0,5 l|500;209;50;<0,1;<0,1;12,3;12,2;<0,1;0,01
Getränke|Mirinda Einweg 0,5 l|500;160;38;<0,1;<0,1;9,4;9,4;<0,1;0,02
Getränke|7 Up Einweg 0,5 l|500;82;19;0;0;4,6;4,6;0;0,03
Getränke|7 Up Zero Zucker Einweg 0,5 l|500;2;0,4;0;0;0;0;0;0,06
Getränke|Schwip Schwap Zero Orange Einweg 0,5 l|500;5;1,2;0;0;0,2;0,2;0;0,02
Getränke|Capri-Sun Orange|200;142;33;<0,5;<0,1;8,0;8,0;<0,5;<0,01
Getränke|Capri-Sun Monster Alarm|200;144;34;<0,5;<0,1;8,1;8,1;<0,5;<0,01
Getränke|Lipton Ice Tea Pfirsich Einweg 0,5 l|500;56;13;0;0;3,1;3;0;0,03
Getränke|Mezzo Mix Einweg 0,5 l|500;183;43;0;0;10,6;10,1;0;0,01
Getränke|S.Pellegrino Mineralwasser 0,5 l|500;0;0;0;0;0;0;0;<0,1
Getränke|Acqua Panna 0,5 l|500;0;0;0;0;0;0;0;<0,1
Getränke|Red Bull Energy Drink 0,25 l|250;194;46;0;0;11;11;0;0,1
Getränke|Red Bull White Edition 0,25 l|250;191;45;0;0;11;11;0;0,1
"""
for line in KFC_PACK.strip().splitlines():
    cat, name, vals = line.split('|')
    v = [n(x) for x in vals.split(';')]
    ph = dict(kj=v[1], kcal=v[2], f=v[3], sat=v[4], c=v[5], sug=v[6], p=v[7], salt=v[8])
    add('KFC', cat, name, v[0], 'ml' if LIQ.search(name) else 'g', None, ph, KFC_SRC, KFC_STAND, KFC_ALIAS)

# ------------------------------------------------------------------ Subway (offiziell)
SUB_SRC = 'Subway Deutschland – Nährwertinformationen März 2026 (subway.com, PDF „germany nutritional information full menu“)'
SUB_STAND = '03/2026'
SUB_ALIAS = 'subway sub sandwich'
# Name;g;kJ;kcal;Fett;ges;KH;Zucker;Ballast;Eiweiß;Salz  (je Portion)
SUB_15 = """
Chicken Teriyaki;227;1130;270;3.3;1.4;38;10;3;22;1.3
Plant-based Chicken Teriyaki;227;1208;289;4.3;1.5;42;9.4;6.4;19;2.2
Chicken Fajita;209;1046;250;2.6;1.2;36;8;3;21;1.8
Rotisserie-Style Chicken;209;1089;260;4;1.2;34;7.1;2.9;21;1.1
Chicken Tandoori;199;1625;388;14;5.9;39;10;2.8;26;2.3
Dölicious Chicken;263;1672;422;16;3.3;46;8.2;4.6;26;3.3
Tuna;227;1397;334;12;1.8;37;8;2.9;20;1.6
Italian B.M.T.;217;1543;369;16;6.4;36;7.6;3.2;21;2.3
BBQ Rib;217;2049;474;26;11;38;7.8;3.9;23;2.4
Nacho Chicken;233;1702;415;17;4.3;47;8.4;3.6;19;1.9
Philly Beef & Cheese;221;1277;304;7.2;3.8;39;9.7;3.3;20;1.7
Salami;169;1061;254;7.6;3.3;35;7.1;2.9;12;1.2
Ham;195;1005;240;3.6;1.4;35;7.6;3.3;17;1.2
Spicy Vegan Patty;238;1473;301;9.6;1.9;44;9.2;6.5;21;1.7
Veggie Delite;165;968;231;5.5;3.1;35;7.4;2.9;11;0.9
Smashed Falafel;245;2027;512;27;5.5;54;8.3;9.9;15;2.9
Plant-based Dölicious Chicken;262;1634;413;13;2;49;7.7;8.8;25;3.9
The BBQ Master;297;2646;622;32;13;56;22;5.3;26;4.4
Furious Chicken;270;2231;522;23;5.7;50;7;5.4;27;3
Fiesta Fajita;255;2218;506;25;5.7;51;8.5;4.9;27;3.4
Tasty Tandoori;199;1625;388;14;5.9;39;10;2.8;26;2.3
Beef Texicana;248;1882;449;20;9.4;42;11;3.4;27;2.7
Chick'n'Garlic;196;1858;444;21;8.2;35;7.5;2.3;27;2.2
Philly Supreme;196;1847;441;20;8.6;40;10;2.7;25;2.5
Smoky Beast;207;1755;421;16;8.1;40;12;2.6;29;2.5
"""
SUB_WRAP = """
Chicken Teriyaki;250;1555;372;7.1;1.2;54;7.5;5;20;1.9
Plant-based Chicken Teriyaki;250;1633;391;8.1;1.3;58;6.9;8.4;17;2.8
Chicken Fajita;232;1471;352;6.4;1;52;5.5;5;20;2.4
Rotisserie-Style Chicken;232;1514;362;7.8;1.1;50;4.6;4.9;20;1.7
Chicken Tandoori;258;1974;472;17;3.7;55;7.3;5.2;23;2.6
Dölicious Chicken;288;1987;507;20;4;58;6.6;6.4;26;3.9
Tuna;250;1822;436;16;1.6;53;5.5;4.9;19;2.1
Italian B.M.T.;236;1900;454;18;5.6;52;5.1;5.2;19;2.7
BBQ Rib;240;2474;576;30;10;53;5.3;5.9;21;3
Nacho Chicken;256;2183;530;22;4.3;62;6.2;5.7;18;2.5
Philly Beef & Cheese;244;1702;406;11;3.7;55;7.2;5.3;19;2.2
Salami;192;1486;355;11;3.1;50;4.6;4.9;11;1.8
Ham;218;1430;342;7.4;1.3;51;5.1;5.3;16;1.7
Spicy Vegan Patty;261;1898;403;13;1.7;60;6.7;8.4;20;2.2
Veggie Delite;188;1393;333;9.3;3;51;4.9;4.9;9.7;1.5
Smashed Falafel;264;2397;573;29;4.6;66;6.8;11;13;3.1
Plant-based Dölicious Chicken;287;1949;498;16;2.8;61;6;11;25;4.5
"""
SUB_SALAD = """
Chicken Teriyaki;293;498;118;1.6;0.5;10;7.7;2.9;15;0.73
Plant-based Chicken Teriyaki;293;577;137;2.6;0.6;14;7.1;6.3;12;1.6
Chicken Fajita;275;414;98;0.9;0.3;7.9;5.7;2.9;14;1.2
Rotisserie-Style Chicken;290;466;109;2.2;0.4;6.4;5;3;15;0.5
Chicken Tandoori;315;1197;285;19;3.5;12;8;3.2;18;1.6
Dölicious Chicken;329;915;283;17;3.7;15;7.2;4.4;21;3.6
Tuna;293;765;182;10;1;8.5;5.7;2.8;14;1.0
Italian B.M.T.;279;843;200;13;5;7.5;5.3;3.1;14;1.6
BBQ Rib;234;1208;271;20;7.7;7.2;4.1;3.4;14;1.5
Nacho Chicken;313;1384;337;23;4.1;20;7.2;3.7;13;1.5
Philly Beef & Cheese;287;645;152;5.4;3;11;7.4;3.2;14;1.1
Salami;235;430;101;5.9;2.4;6.4;4.8;2.8;5.3;0.6
Ham;261;373;88;1.9;0.6;7.1;5.3;3.2;10;0.6
Spicy Vegan Patty;304;841;149;7.8;1.1;16;6.9;6.4;15;1.1
Veggie Delite;231;336;79;3.8;2.3;6.5;5.1;2.8;4.5;0.3
Smashed Falafel;316;1583;377;30;4.4;22;7.5;8.7;8;2.4
Plant-based Dölicious Chicken;328;877;274;14;2.4;17;6.6;8.6;20;4.3
"""
SUB_POTATO = """
Chicken Fajita Baked Potato;484;5052;1216;98;59;55;5.2;7.6;28;1.8
Nacho Chicken Baked Potato;392;2531;610;29;11;62;3.1;8.3;23;1.4
Chicken Teriyaki Baked Potato;412;2425;577;24;11;56;6.0;7.6;32;1.6
Dölicious Chicken Baked Potato;450;2528;634;30;13;59;4.4;9.1;34;2.6
Rotisserie Style Chicken Baked Potato;394;2297;546;25;11;52;2.7;7.5;27;1.2
Chicken Tandoori Baked Potato;394;2300;547;24;11;55;4.5;7.8;28;1.6
Falafel Baked Potato;383;2471;588;29;11;65;3.3;13;18;1.3
BBQ Rib Baked Potato;445;3175;756;41;18;66;26.0;8.6;16;1.8
Philly Beef & Cheese Baked Potato;394;2308;547;24;11;56;4.9;7.9;25;1.4
Tuna Baked Potato;412;2605;620;33;11;54;3.6;7.5;27;1.6
Salami Baked Potato;356;2303;547;29;13;52;2.7;7.5;19;1.4
Italian BMT Baked Potato;402;2751;654;36;16;53;3.2;7.8;27;2.4
Ham Baked Potato;380;2213;526;24;11;53;3.2;7.9;23;1.2
Veggie Delite Baked Potato;419;2061;490;23;10;54;4.6;8.5;16;0.7
Plant-based Chicken Teriyaki Baked Potato;412;2416;575;25;11;60;5.0;11;25;2.3
Plant-based Dölicious Chicken Baked Potato;450;2490;625;27;12;62;3.8;13;33;3.3
Spicy Vegan Patty Baked Potato;423;2681;587;30;11;61;4.8;11;28;1.7
Sour Cream Baked Potato;413;2456;585;31;15;55;5.4;7.5;22;1.5
"""
SUB_OTHER = """
Beilagen|Footlong Cookie;265;5621;1344;68;33;164;94;5.8;15;1.7
Beilagen|Peperoni-Salami & Cheese Footlong Dipper;138;1812;433;19;7.6;49;3.4;3.9;15;2.5
Beilagen|Triple Cheese Footlong Dipper;148;1892;453;19;9.5;49;3.3;3.9;18;2.1
Beilagen|Waffle Fries;100;1085;184;8.2;1.1;23;0.3;4;2.8;0.9
Beilagen|Nacho Chicken Bites (1 Stück);18;188;45;2.1;0.2;3.5;0.2;0.3;2.6;0.2
Beilagen|Falafel Bites;90;945;226;13;1.1;26;1.4;12;6.5;1.2
Beilagen|Lay's Chips Salted;28;620;148;9.4;0.7;14;0.1;1.2;1.7;0.4
Beilagen|Lay's Chips Paprika;28;609;146;8.8;0.7;14;0.7;1.3;1.7;0.4
Beilagen|Doritos Nacho Cheese;44;920;220;11;1.5;26;1.2;2.5;2.9;0.5
Beilagen|Doritos Sweet Chili Pepper;44;918;219;11;1.4;26;2.3;2.5;2.9;0.5
Getränke|Pepsi 0,5 l;500;599;143;0;0;35;35;0;0;0
Getränke|Pepsi Zero Zucker 0,5 l;500;10;2;0;0;0;0;0;0;0
Getränke|Schwip Schwap 0,5 l;500;828;198;0;0;49;48;0;0;0
Getränke|Schwip Schwap Zero 0,5 l;500;30;7;0;0;1.5;1.5;0;0;0
Getränke|Schwip Schwap Zero Orange 0,5 l;500;25;6;0;0;1;1;0;0;0
Getränke|Lipton Eistee Peach 0,5 l;500;279;67;0;0;15;15;0;0;0.15
Getränke|Lipton Eistee Lemon 0,5 l;500;274;66;0;0;15;15;0;0;0.15
Getränke|Adelholzener Classic 0,5 l;500;0;0;0;0;0;0;0;0;0
Getränke|Adelholzener Naturell 0,5 l;500;0;0;0;0;0;0;0;0;0
Getränke|Mountain Dew 0,5 l;500;1058;253;0;0;60;60;0;0;0
Getränke|Capri-Sun Fruit Crush Tropical;200;244;58;0;0;13;13;0;0;0
Desserts|BuddyFruits Fruchtmousse;90;233;56;0;0;12;11;1.7;0.5;0
Saucen|BBQ Sauce (vegan);14;84;21;0;0;4.9;4.2;0.3;0.1;0.4
Saucen|Caesar Sauce;14;210;50;4.8;0.5;1.2;0.7;0;0.4;0.3
Saucen|Chipotle Southwest Sauce;14;258;62;6.3;0.5;1.3;0.8;0;0.1;0.2
Saucen|Döner Sauce;14;137;33;2.6;0.3;1.8;0.9;0.21;0.2;0.4
Saucen|X-spicy Chipotle Sauce (vegan);14;251;60;6.1;0.5;1.1;0.7;0.1;0.2;0.3
Saucen|Honey & Wholegrain Mustard Sauce;14;122;29;1.9;0.1;2.7;2.3;0.2;0.3;0.2
Saucen|Lite Mayonnaise;14;194;46;4.9;0.3;0.6;0.6;0;0;0.2
Saucen|Joghurt Sauce;14;78;18;1.4;0;1.3;0.6;0;0.1;0.2
Saucen|Sweet Onion Sauce (vegan);14;97;23;0.1;0;5.6;4.8;0.1;0.1;0.1
Saucen|Balsamic Vinegar;3.5;4.1;1;0;0;0;0;0;0;0
Saucen|Olivenöl;3.5;131;32;3.5;0.4;0;0;0;0;0
Desserts|Double Chocolate Cookie (vegan);45;876;209;9.5;5.4;27;18;0.5;2.3;0.4
Desserts|Chocolate Chunk Cookie;45;896;214;10;5.1;28;16;1.2;2.3;0.3
Desserts|Chocolate Chip mit Rainbow Candy Cookie;45;894;214;9.8;5;28;18;1.5;2.2;0.1
Desserts|White Chip Macadamia Nut Cookie;45;900;215;10;5.1;27;16;0.5;2.3;0.4
Desserts|Oat & Raisin Cookie;45;587;140;0.6;0.1;28;14;5.9;2.6;0.2
Desserts|Raspberry Cheesecake Cookie;45;871;208;9.6;5.4;27;16;0.2;2.5;0.3
Zutaten|Scheibenkäse;12;177;42;3.5;2.2;0.4;0.4;0;2.3;0.3
Zutaten|Mozzarella-Emmental-Mix;14;187;45;3.4;2.2;0.6;0.1;0;3.2;0.2
Zutaten|Frischkäse;14;115;28;2.2;1.5;0.5;0.5;0;1.2;0.1
Zutaten|Cheddar;11;191;46;3.8;2.3;0.0;0.0;0;2.8;0.2
Zutaten|Vegan Slices;10;124;30;2.4;2.1;1.9;0.0;0.0;0.0;0.1
Zutaten|Guacamole;35;98;24;6.0;0.3;0.9;0.4;0.6;0.7;0.2
Zutaten|Röstzwiebeln;7;171;41;3.0;1.0;2.9;0.6;0.3;0.4;0
Zutaten|Bacon;9;154;37;2.8;1.0;0.2;0.3;0;3.0;0.3
Zutaten|Omelette;70;363;87;4.69;1.4;2.3;0.7;0;7.8;0.8
Brot|Italian (Weißbrot) 15 cm;70;794;190;2.1;0;36;4.2;2.1;7;0.6
Brot|Sesam 15 cm;75;782;187;4;1;29;1;2;8;1
Brot|Cheese Oregano 15 cm;81;816;195;3.9;1.6;30;1;1.9;9.3;0.7
Brot|Honey Oat 15 cm;96;983;235;2.6;0.5;41;9;5;9.5;0.5
Brot|Vollkornbrot 15 cm;76;658;157;0.8;0.2;27;1.4;4.4;7.5;1
Brot|Weizenwrap;95;1153;276;5.7;0.8;48;2.6;3.9;6.7;1.2
Brot|Glutenfreies Brot;110;1229;294;6.6;0.6;53;1.2;3.7;3.3;1.0
"""
def sub_row(s):
    v = [n(x) for x in s.split(';')[1:]]
    name = s.split(';')[0]
    return name, v[0], dict(kj=v[1], kcal=v[2], f=v[3], sat=v[4], c=v[5], sug=v[6], fib=v[7], p=v[8], salt=v[9])

for line in SUB_15.strip().splitlines():
    name, g, pp = sub_row(line)
    add('Subway', 'Subs', f'{name} Sub 15 cm', g, 'g', pp, None, SUB_SRC, SUB_STAND, SUB_ALIAS + ' 15cm')
    # Footlong (30 cm) laut Subway: doppelte Werte (gilt nicht für Salate)
    add('Subway', 'Subs', f'{name} Sub 30 cm (Footlong)', g * 2, 'g', {k: (None if v is None else v * 2) for k, v in pp.items()}, None,
        SUB_SRC + ' – Footlong = 2 × 15 cm laut Subway', SUB_STAND, SUB_ALIAS + ' 30cm footlong')
for line in SUB_WRAP.strip().splitlines():
    name, g, pp = sub_row(line); add('Subway', 'Wraps', f'{name} Wrap', g, 'g', pp, None, SUB_SRC, SUB_STAND, SUB_ALIAS + ' wrap')
for line in SUB_SALAD.strip().splitlines():
    name, g, pp = sub_row(line); add('Subway', 'Salate', f'{name} Salat', g, 'g', pp, None, SUB_SRC, SUB_STAND, SUB_ALIAS + ' salat salad')
for line in SUB_POTATO.strip().splitlines():
    name, g, pp = sub_row(line); add('Subway', 'Kartoffelprodukte', name, g, 'g', pp, None, SUB_SRC, SUB_STAND, SUB_ALIAS + ' kartoffel ofenkartoffel')
for line in SUB_OTHER.strip().splitlines():
    cat, rest = line.split('|'); name, g, pp = sub_row(rest)
    add('Subway', cat, name, g, 'ml' if LIQ.search(name) else 'g', pp, None, SUB_SRC, SUB_STAND, SUB_ALIAS)

# ------------------------------------------------------------------ McDonald's
MCD_SRC = "McDonald's Deutschland (Nährwert- und Allergeninformationen auf mcdonalds.com/de), übernommen über nutriscan.app – abgerufen 21.10.2026"
MCD_STAND = '10/2026'
MCD_ALIAS = 'mcdonalds mcdonald mc donalds mecces macces mcd'
MCD = """
Burger;Hamburger;259;13;29;9,5
Burger;Cheeseburger;307;16;30;13
Burger;Double Cheeseburger;460;27;31;25
Burger;Hamburger Royal Cheese;549;33;38;29
Burger;Big Mac;545;27;42;29
Burger;McDouble Chili Cheese;435;26;28;24
Burger;Hamburger Royal TS;536;30;36;29
Burger;Chickenburger;293;11;34;8,7
Burger;Double Chickenburger;410;17;34;16
Burger;Big Tasty Bacon;912;49;51;57
Burger;McCrispy;525;24;58;21
Burger;Double Hamburger Royal TS;835;54;37;52
Burger;Double Hamburger Royal Cheese;800;54;38;48
Burger;Double Beef Classic;497;23;37;28
Burger;McVeggie TS;449;20;50;17
Burger;McChicken;451;18;49;20
Burger;Fish Filet Classic;393;17;40;18
Nuggets;6 Chicken McNuggets;267;16;18;14
Nuggets;9 Chicken McNuggets;401;24;27;21
Nuggets;20 Chicken McNuggets;892;54;60;47
Nuggets;6 McPlant Nuggets;284;13;21;16
Nuggets;9 McPlant Nuggets;426;20;31;23
Nuggets;20 McPlant Nuggets;947;44;69;52
Wraps;McWrap Veggie Honig-Senf;487;20;52;20
Pommes;Pommes Frites klein;231;2,8;29;11
Pommes;Pommes Frites mittel;329;3,9;41;16
Pommes;Pommes Frites groß;463;5,5;58;22
Salate;Big Chicken Salad;280;14;19;15
Salate;Big Veggie Salad;191;13;16;6,9
Saucen;Barbecue Sauce 25 ml;48;0,2;11;0,3
Saucen;Senf Sauce 25 ml;59;0,6;6,4;3,3
Saucen;Süßsauer Sauce 25 ml;49;0,1;11;0,3
Saucen;Curry Sauce 25 ml;47;0,3;10;0,4
Saucen;Ketchup 20 ml;28;0,4;6,4;0,1
Saucen;Mayonnaise 20 ml;141;0,2;0,4;15
Saucen;Balsamico Dressing 30 ml;22;0;3,2;0,8
Saucen;Sour Cream-Schnittlauch Dip 25 ml;112;0,3;0,5;12
Saucen;Sweet Chili Sauce;67;0,2;16;0
Saucen;Honig-Senf Dressing 50 ml;118;0,6;9,3;8,4
Frühstück;Buttercroissant;335;6,1;39;17
Frühstück;McMuffin Bacon & Egg;297;17;26;13
Frühstück;McToast Bacon & Cheese;279;13;27;13
Frühstück;McMuffin Egg;273;16;26;12
Frühstück;McMuffin Sausage & Egg;417;25;26;23
Frühstück;Big Morning Farmer;534;26;38;30
Frühstück;Big Morning Chicken;469;19;37;22
Frühstück;McWrap Rührei Cheese;487;22;38;27
Frühstück;McWrap Rührei Bacon;565;27;39;33
Frühstück;6 Mini Pancakes;183;3,4;19;10
Frühstück;12 Mini Pancakes;365;6,7;37;21
Frühstück;Big Morning Egg;453;21;37;24
Frühstück;2 McGriddles Pancakes;335;4,7;45;15
Frühstück;McMuffin Fresh Chicken;355;15;37;16
Desserts;McSundae Original mit Schoko-Sauce;285;5,5;46;8,4
Desserts;McSundae Original mit Karamell-Sauce;286;4,7;53;6,1
Desserts;Heiße Apfeltasche;228;2,3;28;12
Milchshakes;Milchshake Vanillegeschmack 0,4 l;313;8,1;57;5,9
Milchshakes;Milchshake Erdbeergeschmack 0,4 l;316;8,1;58;5,9
Milchshakes;Milchshake Bananengeschmack 0,4 l;272;7,2;49;5,3
Desserts;Triple Choc Cookie;383;4,2;46;19
Desserts;McSundae Original;155;4;25;4,1
Desserts;N.Y. Style Cheesecake;469;8;42;30
Desserts;N.Y. Style Cheesecake mit OREO-Topping und Schoko-Sauce;708;11;78;39
Desserts;Himbeer-White Choc Cookie;385;3,9;49;19
Desserts;McPops Berry Bomb;104;1,4;11;6
Desserts;Pistachio Cream Donut;356;5;36;21
Desserts;Choc-Nut Brownie;275;3,5;27;17
Desserts;McPops Pistachio Dream;119;2;9,4;7,9
Desserts;Kirsch-Streusel Kuchen;358;4,5;55;13
Desserts;McPops Coco Kiss;107;1,4;9;7,1
Desserts;McPops mit nutella;122;1,8;13;7
Desserts;Pecannuss Caramel Muffin;491;6,4;45;31
Desserts;Schoko-Banane Donut;247;3,4;30;12
Desserts;Apfel-Zimt Kuchen;401;4,2;51;20
Desserts;McPops Milky Red Velvet;105;1,1;14;2,8
Desserts;McFlurry Original;197;4,8;33;5,2
Getränke;Coca-Cola Classic 0,5 l;200;0;50;0
Getränke;Fanta 0,5 l;185;0;45;0
Getränke;Sprite 0,5 l;159;0;38;0
Kaffee;Café Small;1;0,1;0,2;0
Kaffee;Café Grande;2;0,2;0,2;0
Kaffee;Heißes Kakaogetränk Grande;378;14;45;14
Kaffee;Cappuccino Small;41;2,2;3,1;2,2
Kaffee;Cappuccino Grande;82;4,3;6,1;4,4
Kaffee;Latte Macchiato Grande;110;5,7;8,1;6
Getränke;Coca-Cola Zero Sugar 0,5 l;1;0;0,1;0
Getränke;Lipton Ice Tea Peach 0,5 l;95;2,5;22;2,5
Kaffee;Espresso Grande;1;0,1;0,2;0
Getränke;Red Bull 250 ml;121;0;29;0
Getränke;Lipton Ice Tea Peach Zero;5;0;0;0
Getränke;Iced Coffee Shake Choc 0,4 l;485;9,5;76;15
Kaffee;Earl Grey Tee Regular;0;0;0;0
Kaffee;Fresh Mint Tee Regular;0;0;0;0
Kaffee;Aromatisierter Grüntee;0;0;0;0
Kaffee;Dark Chocolate Grande;356;12;43;13
Kaffee;Espresso Macchiato Grande;8;0,5;0,7;0,4
Kaffee;Iced Latte;97;5,1;7,2;5,3
Getränke;Wasser still 0,5 l;0;0;0;0
Getränke;Wasser sprudelnd 0,5 l;0;0;0;0
Getränke;Sprite Zero 0,5 l;5;0;0;0
Getränke;Red Bull Zero 250 ml;5;0;5;0
Getränke;Lift Apfelschorle 0,5 l;128;0;31;0
Getränke;Orangensaft 0,25 l;120;2;25;0
"""
for line in MCD.strip().splitlines():
    cat, name, kcal, p, c, f = line.split(';')
    pp = dict(kcal=n(kcal), p=n(p), c=n(c), f=n(f))
    pp['kj'] = None if pp['kcal'] is None else pp['kcal'] * 4.184
    alias = MCD_ALIAS + (' mccafe mc cafe' if cat == 'Kaffee' or 'Cookie' in name or 'Donut' in name or 'Kuchen' in name or 'Muffin' in name or 'Cheesecake' in name or 'Brownie' in name or 'Croissant' in name else '')
    add("McDonald's", cat, name, None, 'portion', pp, None, MCD_SRC, MCD_STAND, alias)

# ------------------------------------------------------------------ Ausgabe
seen, out, dups = set(), [], 0
for it in items:
    key = (it['brand'], it['n'].lower())
    if key in seen: dups += 1; continue
    seen.add(key); out.append(it)
for i, it in enumerate(out):
    slug = re.sub(r'[^a-z0-9]+', '-', (it['brand'] + '-' + it['n']).lower().replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')).strip('-')
    it['id'] = 'r:' + slug[:60]
COLS = ['id', 'n', 'brand', 'grp', 'unit', 'kcal', 'kj', 'p', 'c', 'f', 'sat', 'sug', 'fib', 'salt', 'pg', 'pk', 'src', 'stand', 'alias']
srcs = sorted({it['src'] for it in out}); src_ix = {s: i for i, s in enumerate(srcs)}
rows = [[it[c] if c != 'src' else src_ix[it['src']] for c in COLS] for it in out]
today = datetime.date.today().isoformat()
json.dump({'meta': {'source': 'Offizielle Nährwertangaben der Restaurantketten (Deutschland)', 'quality': 'mfr', 'built': today,
                    'sources': srcs, 'note': 'Werte je 100 g/ml; bei unit=portion je 1 Portion (Gewicht vom Hersteller nicht angegeben). null = unbekannt.'},
           'cols': COLS, 'rows': rows}, open('restaurants.json', 'w'), ensure_ascii=False, separators=(',', ':'))
rep = {'datum': today, 'uebernommen': len(out), 'doppelt_entfernt': dups, 'abgelehnt': len(rejected),
       'pro_kette': dict(collections.Counter(it['brand'] for it in out)),
       'pro_kategorie': dict(collections.Counter(f"{it['brand']} · {it['grp']}" for it in out)),
       'abgelehnt_details': [list(r) for r in rejected]}
json.dump(rep, open('ketten-pruefbericht.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: rep[k] for k in ('uebernommen', 'doppelt_entfernt', 'abgelehnt', 'pro_kette')}, ensure_ascii=False))
for r in rejected: print('ABGELEHNT', r)
