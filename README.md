# Mars-bussen

VR-tur til Meta Quest 3: Eleverne kører i en selvkørende bus fra landingspladsen ud til Marsbasen. Hører til forløbet "Marsbase: 50 år på den røde planet" (4.-6. klasse).

**Prøv den:** https://rasmoney-ai.github.io/mars-bus/

Trin 1 (soloturen) er bygget: én passager, lokalt ur og simulerede medpassagerer. En prøveudgave af den fælles tur (trin 2 og 3) ligger klar, men er ikke slået til endnu.

## Sådan bruges den

1. Åbn linket i Meta Quest-browseren.
2. Vælg plads (1-10). Plads 1 og 2 sidder forrest.
3. Tryk **Gå ind i VR**. Turen starter efter en velkomst og en nedtælling.
4. Sid ned, og kig lige frem. Hold Meta-knappen inde for at rette billedet ind. Øjenhøjden sættes selv til en naturlig siddehøjde, når du går ind i VR, og når du retter ind.

Den lille skærm foran din plads har knapperne **Pause / Fortsæt**, **Forfra / Kør igen** og **Komfort til/fra**. Du kan:

- pege og knibe med hånden,
- trykke på aftrækkeren med en controller,
- eller røre skærmen med en finger.

Turen varer ca. 7 minutter, med tre stop (Murray Buttes med roveren Curiosity, et krater og sandklitter) og ankomst til basen. En guide fortæller undervejs med Rasmus' stemme. Lydfilerne ligger i `audio/speak-rasmus/`, og en udgave lavet med ElevenLabs ligger i `audio/speak/`. Se manuskriptet i `docs/speak/manuskript.md`.

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

## Fælles tur (prøveudgave)

Flere briller kan køre i samme bus. Hver elev ser de andre som hjelm og handsker på deres pladser, og turen starter, holder pause og fortsætter samtidig for alle.

Brillerne behøver ikke vide, hvor de er i lokalet. Hver brille kender kun sit sædenummer. Den sender hovedets og hændernes stilling målt ud fra sit eget sæde, og de andre briller tegner hjelm og handsker på det sæde i bussen. Der sendes kun sædenummer og positioner: ingen navne, lyd eller billeder.

Sådan gør man:

1. Læreren åbner `control.html?room=<navn>` på sin computer, fx `https://rasmoney-ai.github.io/mars-bus/control.html?room=svsh-4b`. Siden viser, hvilke pladser der er optaget, og har knapperne **Start turen**, **Pause**, **Tilbage til start** og **Forrige/Næste stop**.
2. Eleverne åbner `https://rasmoney-ai.github.io/mars-bus/?room=<navn>` i brillen og vælger den plads, der svarer til deres stol. Optagne pladser er grå.
3. Alle går ind i VR, sidder ned, kigger lige frem og holder Meta-knappen inde for at rette billedet ind.
4. Læreren trykker **Start turen**.

Uden lærerens side kan en passager starte turen på skærmen foran sin plads. Vælg et navn til turen, som ikke er let at gætte: Alle, der kender navnet, kan stige på.

Stil stolene som sæderne i bussen (to og to med midtergang) og med en armslængde imellem. Man ser de andres handsker, men de virkelige hænder er ikke nødvendigvis præcis dér.

Den fælles tur bruger et lille relæ på nettet, som sender beskederne videre mellem brillerne. Det ligger i mappen `relay/` og skal sættes op én gang (se `relay/README.md`). Indtil relæets adresse står i `src/config.js` (`NETWORK.relayUrl`), fortæller siden, at fælles tur ikke er sat op, og soloturen virker som før.

Den fælles tur er afprøvet med simulerede briller (se `tests/shared-ride/README.md`), men endnu ikke med flere rigtige briller.

## Indstillinger i adressen

- `?room=svsh-4b`: fælles tur med det navn (se ovenfor)
- `?seat=3`: vælg plads 3
- `&comfort=1`: komforttilstand til
- `&sim=0`: ingen simulerede passagerer
- `&speak=0`: intet speak
- `&voice=ai`: guiden taler med stemmen fra ElevenLabs (`audio/speak/`) i stedet for Rasmus' stemme (`audio/speak-rasmus/`)
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
| `src/shadows.js` | bløde skygger under sten og fra klippetårnene, bagt ind |
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
| `src/network.js` | fælles tur: forbindelsen til relæet, det fælles ur og de andre passagerers bevægelser |
| `control.html`, `src/control.js` | lærerens side til den fælles tur |
| `relay/` | relæet til den fælles tur (kører på Cloudflare, ikke på GitHub Pages) |
| `tests/shared-ride/` | test af den fælles tur med simulerede briller |

## Teknik

Sædernes placering (0,9 m mellem rækkerne) ligger fast i busmodellen.

Statisk website uden byggetrin. three.js r186 ligger i `vendor/three/` (MIT-licens), så siden ikke afhænger af et CDN. Alt 3D er bygget i kode, og lyset er bagt ind i farverne. Siden bruger ingen skygger og kun få tegneopgaver. Hostes på GitHub Pages fra `main`.
