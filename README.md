# Mars-bussen

VR-tur til Meta Quest 3: Eleverne kører i en selvkørende bus fra landingspladsen ud til Marsbasen. Hører til forløbet "Marsbase: 50 år på den røde planet" (4.-6. klasse).

**Prøv den:** https://rasmoney-ai.github.io/mars-bus/

Trin 1 (soloturen) er bygget: én passager, lokalt ur og simulerede medpassagerer.

## Sådan bruges den

1. Åbn linket i Meta Quest-browseren.
2. Vælg plads (1-10). Plads 1 og 2 sidder forrest.
3. Tryk **Gå ind i VR**. Turen starter efter en velkomst og en nedtælling.
4. Sid ned, og kig lige frem. Hold Meta-knappen inde for at rette billedet ind.

Den lille skærm foran din plads har knapperne **Pause / Fortsæt**, **Forfra / Kør igen** og **Komfort til/fra**. Du kan:

- pege og knibe med hånden,
- trykke på aftrækkeren med en controller,
- eller røre skærmen med en finger.

Turen varer ca. 7 minutter, med tre stop (Murray Buttes med roveren Curiosity, et krater og sandklitter) og ankomst til basen. En guide fortæller undervejs (speak), når lydfilerne ligger i `audio/speak/`. Se manuskriptet i `docs/speak/manuskript.md`.

## På en almindelig computer

Tryk **Se på skærmen**. Træk med musen for at kigge rundt.

| Tast | Funktion |
|---|---|
| Mellemrum | start / pause |
| ← → | spol 10 sekunder (med Shift: 30) |
| N / F | næste / forrige stop |
| R | forfra |
| K | komforttilstand til/fra |
| P | andre passagerer til/fra |
| 1-9, 0 | skift plads (0 = plads 10) |
| V | se bussen udefra |
| M | lyd til/fra |
| H | skjul hjælp |
| Esc | tilbage til menuen |

## Indstillinger i adressen

- `?seat=3`: vælg plads 3
- `&comfort=1`: komforttilstand til
- `&sim=0`: ingen simulerede passagerer
- `&speak=0`: intet speak
- `&debug`: viser billeder pr. sekund på skærmen foran dig

Eksempel: `https://rasmoney-ai.github.io/mars-bus/?seat=5&comfort=1`

## Hvor justerer man hvad

- `src/config.js`: alle grænser samlet ét sted:
  - komfort: fart, acceleration, drejehastighed, tonetider
  - sæder: øjenhøjde, farven på hjelmens halsbånd og hvor lave ryglænene er
  - tider for velkomst, nedtælling og stop
  - landskab, dis og lys
- `src/route.js`: ruten (lige stykker og sving) og stoppene med navne, tekster og lydfiler til speak.

## Filer

| Fil | Indhold |
|---|---|
| `index.html`, `css/style.css` | startside og skærmvisning |
| `src/main.js` | binder det hele sammen og tegner hvert billede |
| `src/config.js` | alle konstanter |
| `src/route.js` | vejen og fartplanen |
| `src/timeline.js` | tidslinjen: position, tekster og lyde ud fra tiden `t` |
| `src/clock.js` | urkilden (lokalt ur nu, fælles ur i trin 2) |
| `src/marsBus.js` | busmodellen "R-10", lavet med Claude Design (sæder, vinduer, instrumentbræt, hjul) |
| `src/bus.js` | sætter modellen ind i turen: sædepladser, levende kort, infoskærm og hjul |
| `src/terrain.js`, `src/landmarks.js` | Mars-landskab, vej, sten, himmel og landemærker |
| `src/lander.js` | landingsmodulet LM-03, lavet med Claude Design |
| `src/marsBaseSite.js` | Marsbasen som byggeplads, lavet med Claude Design. Strålebeskyttelse, energi, vand og mad er ikke løst, så eleverne selv kan finde løsninger |
| `src/curiosity.js` | roveren Curiosity, lavet med Claude Design |
| `src/rover.js` | Curiosity kører mellem sten ved Murray Buttes, med hjul, mast og arm |
| `src/suitGear.js` | hjelm og handsker, lavet med Claude Design |
| `src/suit.js` | gør hjelm og handsker lette nok til brillen |
| `src/passengers.js` | tegner passagerer (hjelm og handsker) ud fra data |
| `src/simulated.js` | simulerede passagerer |
| `src/hands.js` | dine egne hænder som handsker |
| `src/audio.js` | pladsholderlyd lavet med Web Audio |
| `src/narration.js` | afspiller speaket i takt med turen |
| `audio/speak/` | lydfilerne med speak (mp3) |
| `src/ui/` | skærme i bussen, knapperne foran sædet, startside og skærmvisning |
| `src/xr.js`, `src/desktop.js` | VR-session og mus/taster |
| `src/network.js` | tom indtil trin 2 |

## Teknik

Sædernes placering (0,9 m mellem rækkerne) ligger fast i busmodellen.

Statisk website uden byggetrin. three.js r186 ligger i `vendor/three/` (MIT-licens), så siden ikke afhænger af et CDN. Alt 3D er bygget i kode, og lyset er bagt ind i farverne. Siden bruger ingen skygger og kun få tegneopgaver. Hostes på GitHub Pages fra `main`.
