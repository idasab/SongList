# SongList

Sångtexter med ackord för iPad, iPhone och webben. Byggd med React + TypeScript (Vite) och paketerad
för iOS med Capacitor. All data lagras lokalt i IndexedDB via localForage, med backup och synk via iCloud
på iOS.

## Funktioner

- **Visning**: ackord ovanför texten, transponering, justerbar textstorlek, automatisk scroll,
  mörkt scenläge, dölj ackord, ackorddiagram (gitarr, ukulele eller piano – väljs i Inställningar).
- **Kapo** är information om hur låten spelas: visade ackord ändras inte, men klingande tonart visas.
  Ackorden ändras bara vid transponering.
- **Import**: ChordPro-filer (`.cho`, `.chopro`, `.chordpro`, `.pro`, `.crd`) och textfiler med ackord
  ovanför texten. Textfiler konverteras till ChordPro. För filer skrivna i proportionellt typsnitt
  (Arial, Calibri …) kan man välja typsnitt så att ackorden hamnar där de syns visuellt – inte efter
  antal mellanslag. Filer i UTF-8 och Windows-1252 stöds.
- **Skanning**: fotografera ett papper med text och ackord. På iOS används Apples dokumentskanner och
  Vision (helt på enheten, gratis). I webbläsaren används Tesseract.js. Ackordens position i bilden
  avgör var de placeras i texten. Resultatet öppnas i editorn med originalbilden som referens.
- **Editor**: ChordPro med förhandsvisning (sida vid sida på iPad), fält för titel/artist/tonart/kapo/tempo,
  knappar för sektioner och snabbknappar för låtens ackord, samt "Konvertera" för inklistrad text.
- **Anteckningar**: post-it-lappar (flytta, snurra gradlöst och ändra storlek med fingrarna, egen
  textstorlek och färg) och att rita direkt på låten med fingret eller Apple Pencil. Anteckningarna fästs
  vid raden de sitter på och följer med när textstorlek eller transponering ändras.
- **Organisering**: taggar (flera per låt), kategorier (en per låt), sökning på titel/artist med
  möjlighet att söka i hela texterna, setlistor i mappar med dra-och-släpp och bläddring mellan låtar.
  När en setlista spelas döljs kontrollerna med ett tryck mitt på låten.
- **Backup och synk**: automatisk veckobackup och manuell backup till iCloud Drive › SongList,
  synk mellan iPhone och iPad via iCloud, samt export/import av backupfil på alla plattformar.

## Utveckling

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # enhetstester (ackord, ChordPro, textimport, OCR-layout, synk)
npm run build      # typkontroll + produktionsbygge till dist/
```

## Bygga iOS-appen (på Mac)

Kräver Xcode 16 eller senare och ett Apple Developer-konto.

```bash
npm install
npm run ios:sync   # bygger webbappen och kopierar in den i ios/
npm run ios:open   # öppnar projektet i Xcode
```

Första gången i Xcode:

1. Välj target **App** › **Signing & Capabilities** och välj ditt team.
2. Kontrollera att **iCloud** finns bland capabilities med **iCloud Documents** ikryssat och behållaren
   `iCloud.se.otimo.songlist` vald (filen `ios/App/App/App.entitlements` finns redan; klicka på
   behållaren om den är röd så registreras den i ditt konto).
3. Kör på en riktig enhet. iCloud och dokumentskannern fungerar inte fullt ut i simulatorn.

Byter du bundle-id (`se.otimo.songlist` i `capacitor.config.ts` och Xcode) behöver iCloud-behållaren i
`App.entitlements` och `Info.plist` (`NSUbiquitousContainers`) ändras på samma sätt.

Mappen *SongList* i iCloud Drive syns i appen Filer först när en backup har gjorts. Ändras inställningarna
i `NSUbiquitousContainers` måste byggnumret (`CURRENT_PROJECT_VERSION`) höjas innan iOS läser in dem igen.

## Struktur

```
src/
  lib/            Ren logik (testad): ackord, ChordPro, textimport, OCR-layout, ackordgrepp, synk
  store/          Zustand-tillstånd + localForage (IndexedDB)
  services/       iCloud-synk, backup, filer, OCR
  native/         JS-gränssnitt mot den inbyggda iOS-koden
  components/     Visning av låtar, ackorddiagram, UI-delar
  pages/          Bibliotek, låt, editor, setlistor, import, inställningar
native-plugin/    Egen Capacitor-plugin i Swift: iCloud-filer, VisionKit-skanner, Vision-OCR
ios/              Xcode-projektet (genererat av Capacitor, med iCloud-inställningar)
```

### Hur synken fungerar

Varje enhet skriver en egen fil med hela sitt bibliotek till en dold mapp i appens iCloud-behållare.
Vid synk läses de andra enheternas filer och slås ihop post för post – senast ändrad vinner. Raderade
låtar sparas som "gravstenar" så att raderingen också synkas. Synk sker vid start, när appen öppnas igen
och några sekunder efter varje ändring.
