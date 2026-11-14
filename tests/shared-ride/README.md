# Test af den fælles tur uden briller

Her ligger de test, der afprøver den fælles tur på en almindelig computer. Siden selv bruger ingen af filerne i denne mappe.

| Fil | Hvad den gør |
|---|---|
| `net-clients.mjs` | Afprøver sidens egen netværkskode uden browser: ti passagerer, der stiger på samtidig, det fælles ur, hvem der må styre, bløde bevægelser, en fane der åbnes to gange, en der kommer for sent, og en brille der har sovet. |
| `sim-vr.mjs` | Simulerede Quest 3-briller kører turen sammen i en browser uden skærm. Tjekker, at hver brille tegner de andres hjelm og handsker præcis dér, hvor de andres hoved og hænder er, at en finger på skærmen starter turen for alle, at lærerens side styrer, og at en fuld bus med ti virker. Gemmer billeder i `out/`. |
| `sim-headset.mjs` | Den simulerede brille: Metas "Immersive Web Emulation Runtime" (`iwer`) sat ind i siden, så siden tror, den kører i en Quest 3 med håndtracking. Hoved og hænder flyttes fra testen. |
| `bots.mjs` | Robotpassagerer, der sætter sig på bestemte pladser og bevæger sig roligt. Kan også køres alene for at fylde bussen, mens man selv kigger rundt i en browser. |
| `png.mjs` | Læser skærmbilleder, så testen kan se, om passageren faktisk er i billedet. |

## Sådan køres de

Der skal bruges Node 22 eller nyere.

1. Start relæet på din egen computer (se `relay/README.md`):

   ```
   cd relay
   npm install
   npm run dev
   ```

2. Netværkstesten (ca. et minut):

   ```
   node tests/shared-ride/net-clients.mjs ws://localhost:8787
   ```

3. Testen med simulerede briller (nogle minutter). Den kræver `iwer` og Playwright med Chromium:

   ```
   cd tests/shared-ride
   npm install
   npm install --no-save playwright && npx playwright install chromium   # kun hvis Playwright ikke findes i forvejen
   node sim-vr.mjs ws://localhost:8787
   ```

4. Fyld bussen med robotter, og se selv efter i en browser:

   ```
   node tests/shared-ride/bots.mjs ws://localhost:8787 proeve 1,2,3,5,6,7,8,9,10
   ```

   Åbn derefter siden lokalt med `?room=proeve&seat=4&relay=ws://localhost:8787`. Adressen til relæet kan kun sættes i adressen på denne måde, når siden kører på `localhost`.

## Hvad testene ikke kan vise

En simuleret brille er en rigtig browser, men ikke en rigtig Quest. Disse ting kan kun afprøves med briller:

- om håndtrackingen genkender en pegende barnehånd lige så sikkert som den simulerede hånd,
- om skolens netværk lader forbindelsen til relæet slippe igennem,
- hvordan det lyder, når guiden taler i mange briller på én gang.
