# Relæet til den fælles tur

Et lille program, der sender beskeder videre mellem brillerne i en fælles tur: hvem der sidder hvor, det fælles ur, og hovedets og hændernes stilling. GitHub Pages kan kun vise sider, så relæet kører et andet sted: hos Cloudflare, på det gratis niveau.

Relæet gemmer kun turens ur for hver tur (om bussen kører, og hvor langt den er nået). Det ser sædenumre og positioner, mens de sendes videre, men gemmer dem ikke. Der er ingen navne, lyd eller billeder. Reglerne for beskederne står i `PROTOCOL.md`.

## Sæt det op (én gang, ca. 10 minutter)

1. Opret en gratis konto på https://dash.cloudflare.com/sign-up.
2. Vælg **Workers & Pages** → **Create application**, og forbind til GitHub. Giv kun adgang til repoet `mars-bus`.
3. Vælg repoet. Projektets navn skal være `mars-bus-relay` (det samme som `name` i `wrangler.jsonc`). Sæt **Root directory** til `relay`. Tryk **Save and Deploy**.
4. Under **Settings** → **Build** → **Branch control**: slå "Preview builds" fra, så kun `main` bliver lagt ud.
5. Cloudflare viser nu relæets adresse, fx `https://mars-bus-relay.<dit-navn>.workers.dev`. Åbn den i en browser. Der skal stå `mars-bus relay ok`.
6. Skriv adressen ind i `src/config.js` med `wss://` foran:

   ```js
   relayUrl: 'wss://mars-bus-relay.<dit-navn>.workers.dev',
   ```

Derefter lægger Cloudflare selv en ny udgave ud, hver gang noget i `relay/` ændres på `main`.

Hvis siden får sin egen adresse (fx `marsbus.svsh.dk`), skal den adresse tilføjes i `ALLOWED_ORIGINS` i `wrangler.jsonc`. Ellers afviser relæet siden.

## To ting, der skal prøves på skolen

- **Skolens netværk.** Åbn relæets adresse fra en computer på skolens net. Står der `mars-bus relay ok`, kan brillerne også nå det. Adresser, der ender på `workers.dev`, bliver spærret af nogle netværksfiltre. Så må it-afdelingen åbne for adressen, eller relæet må flyttes til en anden udbyder.
- **Det gratis niveau.** Cloudflare tillader 100.000 forespørgsler om dagen. En tur med ti briller sender ca. 72.000 beskeder. På regningen tæller 20 beskeder som én forespørgsel, og så er der plads til ca. 27 ture om dagen. Det er ikke bekræftet, at grænsen på det gratis niveau tælles på samme måde. Kør to ture samme dag: Virker den anden, er der plads nok. Ellers koster det betalte niveau 5 dollars om måneden. Når grænsen er nået, virker den fælles tur ikke før næste dag, men soloturen virker altid.

## Sådan er det bygget

| Fil | Indhold |
|---|---|
| `src/room-core.js` | reglerne for en tur: sæder, hvem der må styre, uret og videresendelse. Kender ikke Cloudflare og kan derfor flyttes til en anden udbyder |
| `src/worker.js` | forbindelsen til Cloudflare: ét "rum" for hver tur, som husker uret |
| `wrangler.jsonc` | opsætningen, bl.a. hvilke sider der må bruge relæet |
| `PROTOCOL.md` | beskederne mellem brillerne og relæet |
| `test/` | test af relæet |

Et rum oprettes i Cloudflares nærmeste datacenter, altså i Europa for en dansk skole. Skal det være garanteret, at det ligger i EU, kan det slås til i `src/worker.js` (se kommentaren dér).

## Prøv det på din egen computer

Der skal bruges Node 22 eller nyere.

```
cd relay
npm install
npm run dev            # relæet kører nu på ws://localhost:8787
```

Test:

```
npm test               # reglerne for en tur (ingen netværk)
npm run test:protocol  # det rigtige relæ, beskeder for beskeder
npm run test:restart   # uret overlever, at relæet sover eller genstarter
npm run test:load      # en fuld bus i et minut
```

Test af selve siden sammen med relæet, også med simulerede briller, ligger i `tests/shared-ride/`.
