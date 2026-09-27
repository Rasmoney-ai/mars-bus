# Opgave til Claude Design: Landingsmodul (three.js, WebXR / Meta Quest 3)

Lav landingsmodulet, som eleverne er landet med på Mars. Det står på landingspladsen, hvor Mars-bussen "R-10" henter dem. Det skal passe til den bus og de rumdragter, du allerede har lavet: samme stil, samme kvalitet og samme tekniske opbygning.

## Hvad det er

- Et bemandet landingsfartøj til ca. 12 personer, der både kan lande og flyve op igen.
- Det skal være realistisk og tænkt som fremtidens rumfart, ca. 50 år frem. Brug gerne NASA's Mars Ascent Vehicle og konceptskitser af bemandede Mars-landere som inspiration.
- Det må ikke ligne et bestemt, rigtigt fartøj eller firma. Ingen rigtige logoer eller flag. Brug missionsmærket "MARSTUR R-10" fra bussen.
- Idéer til detaljer:
  - hvid og sølvfarvet krop, guldfolie ved motorerne
  - 4-6 landingsben med store fødder
  - motordyser forneden med sod
  - luftsluse med trappe eller lift ned til jorden
  - små vinduer, antenner, solpaneler eller radiatorer
  - ADVARSEL-striber og løbenumre
- Det har landet for nylig: lidt rødt støv på den nederste del og på fødderne.

## Størrelse og placering

- 1 enhed = 1 meter. Y peger op.
- Origo er midt under fartøjet i jordhøjde (y = 0). Fødder og motor må gerne gå 0,3 m under y = 0, så det ser ud til at stå solidt på ujævnt terræn.
- Højde ca. 12-16 m. Største bredde, med ben, højst 14 m.
- Lugen og trappen vender mod +Z. Det er den side, bussen holder ved, ca. 20-25 m væk.

## Teknik

- Lav en ES-modul-fil `lander.js`, der eksporterer `buildLander(THREE, { sunDir })` og returnerer `{ group }`.
- `sunDir` er en `THREE.Vector3` med retningen mod solen, i modellens egne koordinater. Appen giver den med, fordi landingsmodulet kan stå drejet.
- Højst 10.000 trekanter og højst 6 materialer. Flet al geometri med samme materiale sammen til én mesh.
- **Lys og skygge bages ind i farverne** (vertex colors / `color`-attributten), ud fra `sunDir`, med blødt himmellys og lidt mørkere under udhæng og ben. Brug gerne en simpel falsk skygge på jorden: en mørk, blød skive under fartøjet.
- Brug `MeshBasicMaterial` med `vertexColors: true`, ikke `MeshStandardMaterial`. Appen bruger ikke rigtigt lys udenfor bussen.
- Ingen gennemsigtighed, ingen realtidsskygger og ingen efterbehandling.
- Teksturer må tegnes på `<canvas>` (højst 1024 × 1024 i alt). Ingen billedfiler udefra.
- Landskabet har rødbrun jord og en butterscotch-farvet himmel med støvdis. Farverne skal stå godt mod den baggrund.

## Aflevering

Som med bussen: en zip med `lander.js`, en kort README og en præsentationsside til reference.
