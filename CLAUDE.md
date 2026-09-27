# Mars-bussen

Fælles VR-oplevelse til Meta Quest 3: Eleverne sidder på stole i rækker i klasselokalet og kører sammen i en selvkørende bus gennem et Mars-landskab, mens en guide fortæller. Hver elev ser de andre som astronauthjelme og handsker på deres pladser i bussen.

Oplevelsen hører til undervisningsforløbet "Marsbase: 50 år på den røde planet" for 4.-6. klasse. Den er tænkt som ankomsten i forløbets første fase: Bussen kører eleverne fra landingspladsen ud til basen. Komfort og tryghed går forud for effekter.

Projektejer: Rasmus. Han tester i en Quest 3 og foretrækker enkle, velfungerende løsninger.

## Arbejdsform

- Tal dansk med Rasmus, kort og i klart sprog uden kodejargon. Kode, filnavne og kommentarer skrives på engelsk. Al tekst, eleverne ser, er på dansk.
- Byg kun det aktuelle trin (se Plan), i små afsluttede bidder, der kan testes hver for sig.
- Tjek selv dit arbejde, før du afleverer: Kør siden lokalt, se efter fejl i konsollen, og tag skærmbilleder i desktop-tilstand, hvis miljøet tillader det.
- Spørg, før du tilføjer nye afhængigheder, byggeværktøjer eller eksterne tjenester.
- Hver session arbejder på sin egen gren. Afslut med en pull request og en kort besked til Rasmus: hvad der er nyt, og præcis hvad han skal afprøve i brillen. Rasmus merger selv til `main`, medmindre han beder dig gøre det. Derefter er ændringen på GitHub Pages-linket efter et minuts tid.
- Repoet er offentligt: ingen hemmeligheder, nøgler eller persondata.

## Teknik

- Statisk website uden byggetrin: `index.html`, ES-moduler og three.js med WebXR. three.js ligger i repoet (`vendor/`, fast version), så siden ikke afhænger af et CDN.
- Hostes på GitHub Pages fra `main` (rodmappen) på `https://<bruger>.github.io/mars-bus/`. Brug relative stier, og læg en tom `.nojekyll` i roden.
- Målplatform: Meta Quest Browser på Quest 3. Siden skal også kunne køre i en almindelig desktop-browser.
- Brugeren sidder ned med brillens Stationary boundary. Brug reference space `local-floor`, så øjenhøjden passer til en rigtig stol, og håndtér `reset`, når brugeren retter brillen ind med Meta-knappen.
- Håndtracking som valgfri feature. Controllere må ikke være nødvendige.

## Arkitektur (skal holde fra trin 1)

Designet skal kunne blive fælles uden ombygning:

1. **Tidslinjen styrer alt.** Busens position og retning beregnes ud fra turens tid `t` i sekunder langs en fast rute. Stop, lyde og tekster ligger som tidspunkter på tidslinjen. Samme `t` giver altid samme billede: ingen tilfældighed under turen og ingen bevægelse, der lægges sammen frame for frame.
2. **Uret kan skiftes ud.** Tidslinjen får tiden fra en udskiftelig urkilde: lokalt ur (trin 1), lydsporets afspilningstid (trin 4) eller et fælles ur fra serveren (trin 2).
3. **Sæder.** 10 sæder i 5 rækker à 2 med midtergang. Sæde 1 og 2 er forrest. Brugeren vælger sæde på startsiden eller med `?seat=3`, og kameraet placeres på sædet. Sædeafstand og -højde defineres ét sted, så de kan matche stolene i klassen.
4. **Passagerer er data.** De andre passagerer tegnes ud fra en liste med sædenummer samt hoved- og håndpositioner. I trin 1 fyldes listen af simulerede passagerer, i trin 3 af netværket.
5. **Opdeling.** Rute/tidslinje, bus, terræn, passagerer, brugerflade og netværk ligger i hver deres modul. Netværksmodulet er tomt indtil trin 2.

## Komfort (ufravigeligt)

Kørsel i VR giver let kvalme. Disse regler går forud for alt andet, også grafik:

- Kabinen er altid synlig og står stille i forhold til brugeren. Store vinduer, men med fast struktur i synsfeltet: rammer, tag, instrumentbræt.
- Lav, jævn fart: højst ca. 4 m/s (ca. 15 km/t). Accelerationer og opbremsninger er bløde og varer flere sekunder.
- Store, rolige sving: drejehastighed højst ca. 10° pr. sekund. Sænk farten i sving, så grænsen holdes.
- Horisonten er altid vandret: ingen hældning, vippen, rysten eller kamerabevægelse. Ruten ligger på en udjævnet sti, og højdeændringer er små og bløde.
- Stabil billedfrekvens på Quest 3, mindst 72 fps. Hak giver kvalme.
- Komforttilstand (til/fra): Bussen kører ikke mellem stoppene, men toner blødt til sort og ind igen ved næste stop.
- Hele turen varer 5-8 minutter.
- Alle grænser er konstanter, der kan justeres ét sted.

## Ydelse

- Få draw calls og lavt polygonantal. Ingen realtidsskygger: Bag lyset ind, eller fake det.
- Støvdis skjuler horisonten, og terrænet har lav detalje i det fjerne.
- Brug foveated rendering.

## Udseende

- Bussen er inspireret af NASA's SEV-rover (hvid trykkabine med runde boblevinduer foran, mange hjul på et guldfarvet chassis), men strakt til 10 sæder med store sidevinduer og et panoramavindue forrest.
- Ingen fører. Forrest sidder et instrumentbræt med "AUTOPILOT" og et lille kort, der viser, hvor bussen er, og hvor langt der er til næste stop.
- Ingen NASA-logoer eller andre rigtige logoer. Brug et selvopfundet missionsmærke som pladsholder.
- Stiliseret low-poly bygget i kode. Ingen eksterne 3D-modeller i trin 1.
- Mars: rødbrun jord med sten og klipper, butterscotch-farvet himmel med støvdis.
- Passagerer: astronauthjelm med visir og to handsker. Hvert sæde har sin egen hjelmfarve.

## Plan

### Trin 1: Soloturen (nu)

- Startside med sædevalg 1-10 og en knap til at gå ind i VR.
- Buskabine, Mars-landskab og en rute med 3-4 pladsholder-stop, hvor bussen holder 20-30 sekunder.
- Turen starter efter en kort nedtælling i VR og kan genstartes.
- Brugerens egne hænder vises som handsker (håndtracking).
- Pladsholderlyd lavet med Web Audio: motorsummen og et signal ved hvert stop. Ingen speak endnu.
- Simulerede passagerer (til/fra), der kigger lidt rundt og engang imellem peger ud ad vinduet.
- Komforttilstand (til/fra).
- Desktop-tilstand: Kig rundt med musen, og brug taster til start/pause, spring mellem stop og spol i tidslinjen.
- Færdigt, når turen kører hele vejen igennem uden hak fra GitHub Pages-linket i Quest Browser.

### Trin 2: Fælles afgang (senere)

- `control.html` til lærerens computer ("mission control"): viser optagede sæder, starter og pauser turen for alle og afspiller guiden gennem klassens højttaler.
- Et lille WebSocket-relæ uden for GitHub Pages (fx Cloudflare Workers på gratis niveau), ét rum pr. afgang, med ursynkronisering, så alle briller viser samme `t`.

### Trin 3: Se hinanden (senere)

- Hver brille sender sædenummer, hovedposition og håndpositioner ca. 15-20 gange i sekundet. De andre tegner hjelm og handsker.
- Der sendes kun positioner og sædenumre: ingen navne, lyd eller billeder.
- Rasmus har én Quest 3 lige nu. Test med brillen, en desktop-browser som ekstra passager og simulerede passagerer.

### Trin 4: Indhold og finish (senere)

- Rasmus leverer speak og lyddesign. Lydsporet bliver master, og ruten times efter det.
- Rigtige stop og eventuelt rigtigt Mars-terræn fra NASA's HiRISE-højdedata (fx Gale-krateret eller Chryse Planitia).
