# Kalorien – Kalorienzähler für iPhone & Android

Eine Kalorien-App mit [Expo](https://expo.dev) (SDK 58, React Native, TypeScript, Expo Router).
Alle Daten bleiben lokal auf dem Gerät (AsyncStorage) – kein Konto, kein Server.

## Funktionen

- **Tagebuch** – Mahlzeiten (Frühstück, Mittag, Abend, Snacks) pro Tag erfassen, zwischen Tagen wechseln.
  Kalorienring mit „übrig / zu viel“, Fortschrittsbalken für Eiweiß, Kohlenhydrate und Fett.
- **Lebensmittel-Datenbank** – ~100 gängige Lebensmittel mit Nährwerten pro 100 g und typischen Portionen,
  Suche (umlaut-tolerant), „Zuletzt verwendet“.
- **Manuelle Einträge** – beliebige Speisen mit kcal/Makros eintragen und optional unter
  „Meine Lebensmittel“ speichern (langes Drücken in der Liste löscht sie wieder).
- **Wasser-Tracker** – Gläser à 250 ml antippen.
- **Verlauf** – Balkendiagramm für 7 / 14 / 30 Tage, Durchschnitt, Tage im Zielbereich (±10 %).
- **Ziele** – Tagesbedarf nach Mifflin-St Jeor aus Geschlecht, Alter, Größe, Gewicht, Aktivität und Ziel
  (abnehmen / halten / zunehmen); optional eigenes Kalorienziel.
- Hell- & Dunkelmodus, deutsche Oberfläche.

Tipp: Einen Eintrag im Tagebuch antippen → löschen oder (bei vergangenen Tagen) für heute übernehmen.

## Starten

```bash
npm install
npx expo start
```

Dann den QR-Code mit der **Expo Go**-App scannen (iPhone: Kamera-App, Android: Expo Go).
Die App nutzt nur Module, die in Expo Go enthalten sind – kein eigener Build nötig.

Alternativ im Terminal `i` für den iOS-Simulator (macOS) bzw. `a` für den Android-Emulator drücken.

## Für App Store / Play Store bauen

```bash
npx eas-cli@latest build --platform ios       # bzw. android / all
npx eas-cli@latest submit --platform ios
```

Vorher in `app.json` `ios.bundleIdentifier` und `android.package` (derzeit `com.kalorien.app`) auf eine
eigene ID ändern.

## Projektstruktur

```
src/
  app/                 Screens (Expo Router)
    _layout.tsx        Root-Stack + Daten-Provider
    (tabs)/index.tsx   Tagebuch
    (tabs)/history.tsx Verlauf
    (tabs)/profile.tsx Ziele / Profil
    add.tsx            Modal: Lebensmittel hinzufügen
  components/          UI-Bausteine (Card, Button, Kalorienring …)
  lib/
    foods.ts           Lebensmittel-Datenbank
    nutrition.ts       Bedarfsberechnung & Hilfsfunktionen
    store.tsx          Zustand + Speicherung (AsyncStorage)
    theme.ts           Farben hell/dunkel
```

## Entwicklung

```bash
npm run typecheck
```

> Die Nährwerte sind Durchschnittswerte, die Bedarfsberechnung ist ein Richtwert – keine medizinische Beratung.
