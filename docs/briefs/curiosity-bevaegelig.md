# Opgave til Claude Design: Curiosity med bevægelige dele (three.js, WebXR / Meta Quest 3)

Byg videre på din `curiosity.js`, så roveren kan bevæge sig. I Mars-bussen kører Curiosity nu langsomt mellem nogle sten ved Murray Buttes, holder ved en sten og undersøger den, drejer og kører videre. Lige nu glider den som én stiv figur. Hjul, mast og arm skal kunne bevæge sig, så det ser rigtigt ud.

Appen styrer al bevægelse ud fra turens tid. Modellen skal ikke selv animere noget, kun stille sig i den stilling, appen beder om.

## Hvad der skal kunne bevæge sig

- **Hjulene** drejer rundt, når roveren kører.
- **De fire hjørnehjul** (forreste og bageste par) kan styre, så roveren kan dreje på stedet, ligesom den rigtige Curiosity: hjørnehjulene stilles skråt, og den drejer om sin egen midte.
- **Masten**: kamerahovedet kan dreje til siden og vippe op og ned.
- **Armen** kan folde sig ud fra den sammenfoldede stilling og sætte værktøjshovedet ned på en sten ca. 2,0 m foran roverens midte, i jordhøjde. Mellemstillinger skal se naturlige ud, så armen ikke går gennem kroppen eller hjulene.

## API

Behold `buildCuriosity(THREE, { sunDir, groundColor })`, men returnér også en funktion til stillingen og en til lyset:

```js
const rover = buildCuriosity(THREE, { sunDir, groundColor });
scene.add(rover.group);

rover.setPose({
  wheelAngle: 0,  // hjulenes rotation i radianer (appen lægger til, når roveren kører)
  steer: 0,       // 0 = lige ud, 1 = hjørnehjulene stillet til at dreje på stedet
  mastYaw: 0,     // kamerahovedets drejning i radianer (+ = til venstre)
  mastPitch: 0,   // kamerahovedets vip i radianer (+ = op)
  arm: 0,         // 0 = foldet sammen, 1 = værktøjshovedet nede på stenen
});

rover.relight(sunDir); // ny retning mod solen, i roverens egne koordinater
```

- `setPose` kaldes hvert billede og skal være billig: kun transformationer af dele, ingen ny geometri.
- `relight` kaldes, når roveren har drejet, så lyset passer igen. Den må kun opdatere farverne (`color`-attributten) på den eksisterende geometri og skal tage under 2 ms på en Quest 3.

## Lys på dele, der bevæger sig

- Bag hjulenes lys, så det ikke drejer med rundt. Brug fx kun blødt himmellys og mørkere indersider på hjulene, uden retningsbestemt sol, eller en anden løsning, du synes ser bedst ud.
- Mast og arm må gerne have bagt sollys fra den sammenfoldede stilling. Små fejl i lyset, mens de bevæger sig, er i orden.
- Jordskyggen må gerne være én fast skive under roveren, der følger med, når den kører.

## Teknik (som før)

- 1 enhed = 1 meter. Y peger op. Origo i jordhøjde midt under roveren. Forenden (masten og armen) vender mod +Z.
- Samme udseende og mål som din nuværende `curiosity.js`: støvet, slidt, ingen logoer, flag eller skrift.
- Højst 7.000 trekanter og højst 8 draw calls i alt. De seks hjul må gerne være én `InstancedMesh`.
- `MeshBasicMaterial` med `vertexColors: true`. Lys og skygge bages ind i farverne. Ingen realtidslys, skygger, gennemsigtighed eller efterbehandling.
- Teksturer må tegnes på `<canvas>` (højst 512 × 512 i alt). Ingen billedfiler udefra.

## Aflevering

En zip med `curiosity.js`, en kort README og en præsentationsside med skydere til `wheelAngle`, `steer`, `mastYaw`, `mastPitch`, `arm` og solens retning, så man kan prøve alle stillinger.
