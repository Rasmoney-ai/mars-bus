# Opgave til Claude Design: Marsbasen (three.js, WebXR / Meta Quest 3)

Lav Marsbasen, som er målet for turen med Mars-bussen "R-10". Bussen kører hen mod basen og holder foran indgangen, mens eleverne kigger ud. Basen skal passe til bussen og rumdragterne, du allerede har lavet: samme stil, samme kvalitet og samme tekniske opbygning.

## Hvad det er

- En realistisk base, som den kunne se ud om ca. 50 år. Undervisningsforløbet hedder "Marsbase: 50 år på den røde planet", og basen har eksisteret i en årrække.
- Byg den ud fra, hvad forskere forestiller sig:
  - **Beboelse** beskyttet mod stråling: moduler dækket af et lag Mars-jord eller sandsække, oppustelige kupler og nedgravede dele.
  - **Drivhus** med grønne planter bag vinduer, gerne med et svagt, varmt lys.
  - **Energi:** marker med solpaneler og en lille atomkraftenhed (kilopower) et stykke væk bag en jordvold.
  - **Kommunikation:** en antennemast og en parabol.
  - **Garage** med sluse til rovere og en ladestation. Bussen holder foran.
  - **Forråd:** tanke og containere. Gerne spor, stier og hjulspor mellem bygningerne.
  - **Detaljer:** lamper ved indgangen, skilte ("MARSBASEN", "LUFTSLUSE"), ADVARSEL-striber og lidt rødt støv på alt.
- Det skal ligne et sted, hvor folk bor og arbejder, ikke en rumstation.
- Ingen rigtige logoer eller flag. Brug missionsmærket fra bussen eller et selvopfundet basemærke.

## Størrelse og placering

- 1 enhed = 1 meter. Y peger op.
- Origo er midt i basen i jordhøjde (y = 0). Terrænet er fladt inden for 55 m fra origo. Fundamenter må gerne gå 0,5 m under y = 0.
- Hele basen skal være inden for ca. 110 × 80 m.
- **Indgangen vender mod +Z.** Bussen kommer kørende fra +Z mod -Z og holder med fronten ca. 25 m fra origo, i en afstand af 15-20 m fra indgangen. Hold et område fri for bygninger: fra x = -6 til 6 og fra z = 20 til 60.
- Det højeste punkt er 15-20 m. Det største, man ser fra bussen, bør være det nærmeste: indgang, garage og beboelse.

## Teknik

- Lav en ES-modul-fil `marsBase.js`, der eksporterer `buildMarsBase(THREE, { sunDir })` og returnerer `{ group }`.
- `sunDir` er en `THREE.Vector3` med retningen mod solen, i modellens egne koordinater.
- Højst 30.000 trekanter og højst 8 materialer. Flet al geometri med samme materiale sammen til én mesh.
- Basen ses mest på 20-300 m afstand. Brug detaljerne på det, der er tættest på bussen, og hold resten enkelt.
- **Lys og skygge bages ind i farverne** (vertex colors / `color`-attributten), ud fra `sunDir`. Brug blødt himmellys, mørkere nederst og i hjørner, og falske skygger på jorden som mørke, bløde flader.
- Brug `MeshBasicMaterial` med `vertexColors: true`, ikke `MeshStandardMaterial`. Appen bruger ikke rigtigt lys udenfor bussen.
- Ingen gennemsigtighed. Drivhusvinduer og lignende laves som uigennemsigtige flader med malede planter eller lys. Ingen realtidsskygger og ingen efterbehandling.
- Teksturer må tegnes på `<canvas>` (højst 2048 × 2048 i alt). Ingen billedfiler udefra.
- Landskabet har rødbrun jord og en butterscotch-farvet himmel med støvdis. Basen skal skille sig tydeligt ud: hvidt og lyst grå med orange og guld som accentfarver.

## Aflevering

Som med bussen: en zip med `marsBase.js`, en kort README og en præsentationsside til reference.
