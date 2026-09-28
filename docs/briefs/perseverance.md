# Opgave til Claude Design: Roveren Perseverance (three.js, WebXR / Meta Quest 3)

Genskab NASA's rover Perseverance i three.js ud fra den vedhæftede `perseverance.glb`. Den skal stå i Mars-bussens landskab ved siden af din Curiosity, med samme stil, kvalitet og tekniske opbygning, også de bevægelige dele. Byg den som en ny fil, der følger samme API som din bevægelige `curiosity.js`, så appen kan styre begge rovere på samme måde.

`perseverance.glb` er kun til reference for form og proportioner. Appen må ikke indlæse den. Alt bygges i kode.

## Hvad det er

- Den rigtige rover Perseverance (Mars 2020). Den er i gang med at arbejde: kører langsomt, borer prøver ud af sten og undersøger dem.
- Den ligner Curiosity, men der er forskelle, som skal være tydelige, så eleverne kan se, at det er to forskellige rovere:
  - større og kraftigere hjul med færre, lige riller
  - kamerahovedet med SuperCam øverst
  - et større værktøjshoved på armen med kerneboret
  - prøvesystemet under bugen og strømkilden (MMRTG) bagpå
- Gengiv hellere de store former rigtigt end de små detaljer.
- Farver som Curiosity: hvide flader, lys aluminium, guld- og kobberdetaljer, sort strømkilde, mørke kameraer. Lidt mindre støvet end Curiosity, da den er nyere.
- **Ingen logoer, flag eller skrift.** Det gælder også NASA- og JPL-mærker og pladen med silhuetterne af de tre rovere.

## Størrelse og placering

- 1 enhed = 1 meter. Y peger op.
- Rigtig størrelse: ca. 3,0 m lang, 2,7 m bred og 2,2 m høj til toppen af masten. Hjuldiameter ca. 0,53 m.
- Origo er midt under roveren i jordhøjde (y = 0). Forenden (masten og armen) vender mod +Z.
- Den står ca. 10-15 m fra bussen og ses mest skråt forfra og fra siden.

## Bevægelige dele og API

Samme API som din bevægelige Curiosity:

```js
import { buildPerseverance } from './perseverance.js';
const rover = buildPerseverance(THREE, { sunDir, groundColor });
scene.add(rover.group);

rover.setPose({
  wheelAngle: 0,  // hjulenes rulning i radianer (+ = frem)
  steer: 0,       // 0 = lige ud, 1 = hjørnehjul stillet til drejning på stedet
  mastYaw: 0,     // kamerahovedets drejning (+ = til venstre, mod +X)
  mastPitch: 0,   // kamerahovedets vip (+ = op)
  arm: 0,         // 0 = foldet sammen, 1 = værktøjshovedet nede på stenen
  turnYaw: 0,     // roverens samlede drejning på stedet (rad, + = til venstre)
});
rover.relight(sunDir);  // kun farver, under 2 ms på Quest 3
rover.info;             // { wheelRadius, armTarget, wheels }
```

- `arm` = 1 sætter kerneboret lodret ned på en sten ca. 2,0 m foran roverens midte, i jordhøjde. Banen må ikke gå gennem krop eller hjul.
- `setPose` må kun lave transformationer, ingen ny geometri eller allokeringer.
- Hjulenes lys må ikke dreje med rundt, ligesom på Curiosity.

## Teknik (som Curiosity)

- Højst 7.000 trekanter og højst 8 draw calls. Hjulene må gerne være én `InstancedMesh`.
- `MeshBasicMaterial` med `vertexColors: true`. Lys og skygge bages ind i farverne ud fra `sunDir`, med himmellys, jordrefleks, skygge fra kroppen og rødt støv på vandrette flader. Falsk jordskygge som en fast skive under roveren.
- Ingen realtidslys, skygger, gennemsigtighed eller efterbehandling.
- Teksturer må tegnes på `<canvas>` (højst 512 × 512 i alt). Ingen billedfiler udefra.

## Aflevering

En zip med `perseverance.js`, en kort README og en præsentationsside med skydere for alle stillinger og solens retning. Vis gerne Curiosity ved siden af, så forskellene og størrelsen kan sammenlignes.
