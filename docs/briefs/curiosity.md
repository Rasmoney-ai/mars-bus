# Opgave til Claude Design: Roveren Curiosity (three.js, WebXR / Meta Quest 3)

Genskab NASA's rover Curiosity i three.js ud fra den vedhæftede `curiosity.glb`. Modellen skal stå i Mars-bussens landskab. Den skal passe til bussen, rumdragterne, landingsmodulet og Marsbasen, som du allerede har lavet: samme stil, samme kvalitet og samme tekniske opbygning.

`curiosity.glb` er kun til reference for form og proportioner. Appen må ikke indlæse den. Alt bygges i kode, ligesom de andre modeller.

## Hvad det er

- Den rigtige rover Curiosity. Den står ved klippetårnene Murray Buttes, hvor den kørte forbi i 2016.
- I fortællingen er der gået 50 år. Roveren holder stille for altid og er blevet et historisk minde, som eleverne ser fra bussen.
- Formen skal være tro mod originalen og tydelig at genkende, også på 15-20 meters afstand:
  - seks store hjul på rocker-bogie-ophænget
  - den flade krop
  - masten med kamerahovedet
  - robotarmen med værktøjshovedet
  - den sekskantede parabolantenne
  - strømkilden (RTG) med køleribber bagpå
- Gengiv hellere de store former rigtigt end de små detaljer.
- Farver: lys aluminium og hvide flader, guld- og kobberfarvede detaljer, sort RTG og mørke kameraer.
- Slidt efter mange år på Mars: tykt lag rødt støv på alle vandrette flader, mest på dækket og solsiden. Hjulene har de kendte buler og huller.
- **Ingen logoer, flag eller skrift.** Det gælder også NASA- og JPL-mærker, selv om de sidder på originalen.

## Størrelse og placering

- 1 enhed = 1 meter. Y peger op.
- Rigtig størrelse: ca. 3,0 m lang, 2,8 m bred og 2,2 m høj til toppen af masten. Hjuldiameter ca. 0,5 m.
- Origo er midt under roveren i jordhøjde (y = 0). Hjulene må gå 0,05 m under y = 0, så den står solidt på ujævnt terræn.
- Roverens forende (masten og armen) vender mod +Z. Det er den side, bussen holder ved, ca. 15 m væk.
- Masten må gerne være drejet lidt, som om kameraet kigger mod bussen. Armen er foldet sammen foran.

## Teknik

- Lav en ES-modul-fil `curiosity.js`, der eksporterer `buildCuriosity(THREE, { sunDir, groundColor })` og returnerer `{ group }`.
- `sunDir` er en `THREE.Vector3` med retningen mod solen, i modellens egne koordinater. Appen giver den med, fordi roveren kan stå drejet.
- `groundColor` er jordens farve under roveren (hex-streng), til den falske skygge og til støvet.
- Højst 6.000 trekanter og højst 4 materialer. Flet al geometri med samme materiale sammen til én mesh.
- **Lys og skygge bages ind i farverne** (vertex colors / `color`-attributten), ud fra `sunDir`, med blødt himmellys og mørkere under dækket og mellem hjulene. Brug en simpel falsk skygge på jorden: en mørk, blød skive under roveren.
- Brug `MeshBasicMaterial` med `vertexColors: true`, ikke `MeshStandardMaterial`. Appen bruger ikke rigtigt lys udenfor bussen.
- Ingen gennemsigtighed, ingen realtidsskygger og ingen efterbehandling.
- Teksturer må tegnes på `<canvas>` (højst 512 × 512 i alt). Ingen billedfiler udefra.
- Landskabet har rødbrun jord, lagdelte klipper i lys tan og en butterscotch-farvet himmel med støvdis.

## Aflevering

Som med de andre modeller: en zip med `curiosity.js`, en kort README og en præsentationsside til reference.
