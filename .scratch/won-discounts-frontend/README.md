# Won Discounts 2.0 — frontend podle auditu 2026-11-03

Zdroj: [`docs/won-discounts/audit-frontend-2026-11-03.md`](../../docs/won-discounts/audit-frontend-2026-11-03.md)
(nálezy F1–F11, D1–D3, X1–X3, cílová architektura, zásady E1–E11).
Tickety: [`issues/`](issues/), číslované v pořadí závislostí. Každý má „Blocked by“ a „Status“.

## Rozhodnutí Ondřeje (neotevírat znovu)

- **Jedno uložení na stránku, jako nativní Shopify:** jen Save Bar App Bridge. Žádné inline „Uložit“, žádný
  druhý formulář s vlastním tlačítkem. Jednorázové akce (Přesunout, Vyzkoušet Pro, Zapnout na webu) zůstávají tlačítky.
- **„Neaktivní“ v tabulce slev → „Neuplatní se“.** „Vypnuto“ zůstává. Slovník dlaždic (Aktivní / Vyžaduje
  pozornost / Neaktivní) se nemění.
- **Vlastní vizuál zůstává, nepřechází se čistě na Polaris.** Polaris neumí barevné plochy ani rámečky
  (pozadí jen transparent/subdued/base/strong). Výjimky ve `shell/` proto zůstávají:
  jantarové Pro plochy, červený rámeček karty s pozorností, modrý rámeček vybrané dlaždice, světle oranžové
  „Naplánováno“, klikací dlaždice a segmentová volba. Všechno ostatní jsou `s-*` komponenty.
- **Platí dřívější rozhodnutí:**
  - domovská stránka V3: skupiny, modrý štítek názvu, stav vpravo nahoře;
  - „Pro“ na dlaždicích i na tarifu Pro;
  - „Aktivní“ na dlaždicích;
  - Slevy a Milníky jako Seznam + tabulka;
  - PageGuide na 9 obrazovkách;
  - Umístění varianta X;
  - klidný vzhled bez efektů;
  - každá stránka proklikatelná z menu.

## Hranice

- Backend se nemění: `app/lib/integration/**`, `app/lib/**/*.server.ts`, Prisma, `extensions/`, webhooky,
  API kontrakty a tvar dat odesílaných do akcí. Routy smí měnit jen to, co skládá formulář a vykresluje.
- Storefront (`themes/`, theme extension) se nemění.
- Formátovat ručně podle okolí (~160 znaků na řádek). Žádný prettier, repo ho nemá a přeformátoval by tisíce řádků.

## Ověření každého ticketu

```bash
cd apps/won-discounts
SHOPIFY_APP_URL=http://localhost:3411 SHOPIFY_API_KEY=dev SHOPIFY_API_SECRET=dev SCOPES=read_products \
  DATABASE_URL="file:$PWD/prisma/dev.sqlite" npx react-router dev --port 3411 --strictPort   # harness, na pozadí
npm run test:unit
npm run typecheck && npm run lint
WON_PREVIEW_BASE_URL=http://localhost:3411 npm run test:e2e:preview
node ../../docs/won-discounts/evidence/frontend-audit-2026-11-03/capture.mjs <výstupní složka>   # 390 + 1440, metrics.json
```

- Vizuální změnu dokládají screenshoty 390 a 1440 px. Porovnávají se s baseline v
  `docs/won-discounts/evidence/frontend-audit-2026-11-03/`.
- Save Bar a hlídání odchodu harness neukáže. U ticketů 09–11 je potřeba ruční ověření v `shopify app dev`,
  které udělá Ondřej. Do ticketu se zapíše přesný postup.
- `docs/product-roadmap.html` se aktualizuje podle `AGENTS.md`.
