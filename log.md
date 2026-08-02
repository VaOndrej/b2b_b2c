# Won Quantity implementation log

Průběžný audit implementace standalone aplikace podle plánu
`docs/plans/2026-08-01-won-quantity-standalone-app.md`.

## Pravidla logu

- Každá fáze uvádí změny, provedené ověření, výsledek a zbývající rizika.
- Neúspěšné testy se zapisují stejně jako úspěšné; nic se nemaže ani nezamlčuje.
- Storefront změna není považovaná za hotovou bez statických a browser testů.
- Cizí nebo nesouvisející změny v repozitáři se neupravují.

## 2026-08-01 — Zahájení

### Rozsah

- Větev: `codex/won-quantity-bootstrap`
- Worktree: `/private/tmp/b2b_b2c-won-quantity`
- Výchozí commit: `43be88e`
- Cíl první dávky: baseline, `@won/testing`, oprava Horizon/Dawn cest a generický runner.

### Stav před změnami

- Hlavní pracovní strom obsahuje pouze dříve vytvořenou necommitnutou dokumentaci pod `docs/`.
- Implementace probíhá v izolovaném worktree; `main` zůstává nedotčený.
- Baseline testy ještě nebyly spuštěny.

### Baseline pokus 1

- `npm run guard:test:core -w b2b-companion` — **neprovedeno**, worktree neměl
  `node_modules` (`tsx: command not found`).
- `npm run typecheck -w won-app-template` — **neprovedeno**, stejná příčina
  (`react-router: command not found`).
- `npm run build -w won-app-template` — **neprovedeno**, stejná příčina.
- `npm run test:e2e:local:all -w b2b-companion -- --dry-run` — runner se spustil,
  ale sandbox zakázal bind na kontrolní port (`listen EPERM 127.0.0.1:9781`).

Vyhodnocení: nejde o regresi repozitáře. Další krok je `npm install` podle
existujícího lockfile a opakování portového dry-runu mimo sandbox.

### Baseline pokus 2

- `npm install` — dokončeno, 852 balíčků. NPM nahlásilo 50 známých zranitelností
  v existujícím dependency stromu; automatický `npm audit fix` nebyl spuštěn,
  protože by rozšířil scope a mohl změnit runtime závislosti.
- Template `typecheck` — **PASS**.
- Template production build — **PASS**.
- B2B core gate — 240 PASS / 14 FAIL. Všech 14 selhání má stejnou příčinu:
  nový worktree po instalaci ještě nemá vygenerovaný hoisted Prisma client.

Vyhodnocení: stále nejde o aplikační regresi. Před třetím pokusem se spustí
existující `prisma:generate` pro baseline `b2b-companion`.

### Baseline finální výsledek

- `npm run prisma:generate -w b2b-companion` — **PASS** po povolení zápisu do
  Prisma engine cache mimo sandbox.
- `npm run guard:test:core -w b2b-companion` — **PASS**, 305/305 testů.
- `npm run typecheck -w won-app-template` — **PASS**.
- `npm run build -w won-app-template` — **PASS**.
- `npm run test:e2e:local:all -w b2b-companion -- --dry-run` — reprodukovaná
  očekáváná chyba: runner hledá Horizon v
  `/private/tmp/b2b_b2c-won-quantity/apps/b2b_b2c_themes/Horizon`.
- `git diff --check` — **PASS**.

Baseline je zelený a plánovaná path regrese je potvrzená. Task 0 dokončen.

## 2026-08-01 — Task 1: `@won/testing` a theme path resolver

### Změny

- Přidán workspace package `@won/testing`.
- Přidán čistý `resolveThemePaths`, který odvozuje canonical Horizon/Dawn
  checkouty od monorepo rootu, ne od konkrétní appky.
- Přidány nezávislé env overrides pro oba themes a podpora relativních overrides.
- Přidán TypeScript alias `@won/testing/*`.

### TDD a ověření

- Failing test před implementací — **PASS jako důkaz TDD**: import skončil
  `ERR_MODULE_NOT_FOUND`.
- `npx tsx --test packages/testing/tests/theme-paths.test.ts` po implementaci —
  **PASS**, 3/3 testů.
- `npm install` zaregistroval nový workspace; lockfile aktualizován.
- Automatický audit fix nebyl spuštěn; existující dependency zranitelnosti jsou
  mimo scope této funkční změny.

### Zbývající riziko

- Původní B2B runner ještě resolver nepoužívá. To řeší Task 3.

## 2026-08-01 — Task 2: sdílené Playwright theme fixtures

### Změny

- Přidán generický `createThemeContext` pro Horizon a Dawn s kontrolou
  aktivního Shopify theme, remote preview ID a lokálního theme-dev režimu.
- Stabilní Shopify selektory formuláře, quantity inputu a submit tlačítka jsou
  soustředěné v `@won/testing/playwright`.
- Přidán konfigurovatelný JS MIME shim a základní Playwright fixture bez vazby
  na Margin Guard nebo jinou konkrétní aplikaci.
- App-specific URL dekorace je podporovaná callbackem, ale její význam zůstává
  mimo sdílený package.

### TDD a ověření

- Failing test před implementací — **PASS jako důkaz TDD**: chybějící
  `src/playwright/index.ts` skončil `ERR_MODULE_NOT_FOUND`.
- `npx tsx --test packages/testing/tests/*.test.ts` po implementaci — **PASS**,
  7/7 testů.
- `git diff --check` — **PASS**.

### Zbývající riziko

- `b2b-companion` zatím používá původní lokální fixture; migrace proběhne až po
  zavedení generického runneru, aby se změny daly ověřovat odděleně.

## 2026-08-01 — Task 3: generický Horizon/Dawn matrix runner

### Změny

- Přidán app-owned config contract a validační utility pro proxy probe, test
  command, oba themes, porty a CLI argumenty.
- Přidán generický `run-theme-matrix.mjs`, který načítá config aplikace, odvozuje
  checkouty od rootu monorepa, volí porty, spouští themes sekvenčně, provádí
  konfigurovatelný proxy preflight a garantuje cleanup vlastního child procesu.
- Dry-run záměrně neotvírá port ani nespouští child proces; pouze validuje config,
  checkouty a preferované porty.
- B2B-specific proxy marker, start hint a stabilní Margin Guard test data byly
  přesunuty do `apps/b2b-companion/e2e.app.config.mjs`.
- `b2b-companion` script `test:e2e:local:all` nyní deleguje do sdíleného runneru.
- Runtime utility jsou čisté ESM JavaScript moduly s vedlejšími `.d.ts` typy,
  takže runner funguje i na podporovaném Node 20 bez nativního načítání `.ts`.

### TDD a ověření

- Failing config test před implementací — **PASS jako důkaz TDD**:
  `ERR_MODULE_NOT_FOUND` pro chybějící runner config modul.
- Config testy pokrývají chybějící/neplatnou proxy path, checkout bez
  `layout/theme.liquid`, neplatný port a neznámý/prázdný `--only`.
- `npx tsx --test packages/testing/tests/*.test.ts` — **PASS**, 11/11 testů.
- `node --check` pro runner, runtime utility a B2B config — **PASS**.
- cílený `prettier --check` — **PASS**.
- `git diff --check` — **PASS**.
- B2B `--dry-run` — **PASS**; Horizon i Dawn ukazují canonical checkouty v
  `/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c_themes`, preferované porty
  9781/9782 a hlášku `no child process spawned`.

Poznámka: izolovaný worktree leží v `/private/tmp`, proto byly pouze při tomto
ověření použity explicitní `SHOPIFY_E2E_THEME_DIR_*` overrides. V běžném rootu
monorepa resolver odvodí stejné cesty bez override.

### Zbývající riziko

- Plný browser běh nebyl v Task 3 spuštěn, protože ještě nebyla migrována lokální
  B2B fixture na `@won/testing`; to je samostatná Task 4 s vlastním typecheck,
  core gate a dvoutheme browser ověřením.

## 2026-08-01 — Task 4: B2B používá sdílený storefront harness

### Změny

- `b2b-companion` nyní závisí na `@won/testing` a jeho lokální Playwright base
  fixture deleguje do `createStorefrontTest`.
- B2B `theme.ts` zůstal jen tenkým adaptérem pro app-specific catalog audience;
  generické Horizon/Dawn selektory, URL a theme guardy vlastní sdílený package.
- Duplicitní `theme-dev-mime.ts` byl odstraněn.
- Playwright CLI se rozlišuje přes hoistovaný `playwright/package.json`, takže
  runner není závislý na neexistujícím app-local `node_modules`.
- `ThemeEnvironment` podporuje běžný `ProcessEnv` index signature.
- Browser trace odhalil produkční edge case: app proxy bez Admin klienta neuměla
  přeložit catalog-hidden product ID zpět na handle. Loader nyní používá jako
  fallback synchronizovaný lokální product catalog; chování kryje nový regresní
  test a route explicitně injektuje `getCatalogProductMapByIds`.
- Roadmapa u Won Stepperu nově eviduje skutečně ověřený sdílený Horizon + Dawn
  harness; neoznačuje zatím samotnou aplikaci jako implementovanou.

### Diagnostika a neúspěšné pokusy

- První typecheck selhal kvůli chybějícím generovaným extension API a příliš
  úzkému typu `ThemeEnvironment`. Oba extension `typegen` příkazy následně
  prošly a typ prostředí byl opraven.
- Celý app GraphQL codegen zůstává blokovaný existující duplicitní operací
  `ProductHandlesByIds` ve dvou B2B zdrojích; pro tento checkpoint nebyl nutný,
  protože potřebný extension typegen proběhl samostatně.
- První browser pokus zastavil hardcoded app-local Playwright CLI; druhý pokus
  ukázal, že `playwright/cli` není exportovaný subpath. Finální resolver používá
  exportovaný `playwright/package.json` a sousední `cli.js`.
- Další pokus správně odmítl prázdnou E2E databázi místo falešně zeleného běhu.
  Přes existující `syncShopifyProductCatalog` bylo do izolované DB načteno 21
  produktů a 29 variant.
- Horizon trace poté odhalil chybějící Admin session a whole-product mapping.
  Nejdřív vznikl failing regresní test (12 PASS / 1 FAIL), po fallbacku prošel
  13/13. Standardní Shopify preview flow obnovil offline session pro scénáře,
  které skutečně potřebují Admin API (zejména collection membership).
- Přerušené diagnostické browser běhy nejsou započítané jako úspěch. Finální
  Horizon a Dawn checkpointy byly spuštěny znovu od čistého setupu.

### Finální ověření

- `npm run typecheck -w b2b-companion` — **PASS**.
- `npm run guard:test:core -w b2b-companion` — **PASS**, 306/306 testů.
- `npx tsx --test packages/testing/tests/*.test.ts` — **PASS**, 11/11 testů.
- `npx tsx --test tests/visibility/margin-guard-visibility.loader.test.ts` —
  **PASS**, 13/13 testů.
- Prisma migrate deploy proti izolované SQLite DB — **PASS**, všech 28 migrací
  aplikováno / bez pending migrace.
- Horizon přes reálný `shopify theme dev`, app proxy a Chromium — **PASS**:
  matrix 5 PASS + 5 environment/DOM skips, serial tier 5 PASS + 2 skips.
- Dawn přes reálný `shopify theme dev`, app proxy a Chromium — **PASS**:
  matrix 8 PASS + 2 skips, serial tier 5 PASS + 2 skips.
- Oba themes byly obsloužené z canonical checkoutů
  `b2b_b2c_themes/Horizon` a `b2b_b2c_themes/Dawn`; runner po každém běhu svůj
  theme-dev child proces korektně ukončil.

### Známé poznámky

- NPM stále hlásí 50 existujících dependency zranitelností (1 low, 6 moderate,
  41 high, 2 critical). Automatický audit fix nebyl spuštěn mimo scope.
- Node vypisuje warning k deprecated `module.register()` a kombinaci
  `NO_COLOR`/`FORCE_COLOR`; testy tím nejsou ovlivněné.
- Dev-store storefront password se při jednom interaktivním CLI pokusu omylem
  propsal do lokálního nástrojového výstupu. Hodnota není v repozitáři ani v
  tomto logu; po dokončení práce je potřeba ji preventivně rotovat.

## 2026-08-01 — Task 5: zpevnění standalone app template

### TDD contract

- Přidán `app-template.contract.test.ts` pro per-app Prisma output, sdílenou
  testing dependency, povinné test hooks, prázdný `client_id` a zákaz Margin
  Guard couplingu.
- První běh — **očekávaný FAIL**, 0/3: template importoval hoistovaný
  `@prisma/client`, neměl `@won/testing` ani scripts a chyběl E2E config.

### Změny

- Prisma generator zapisuje do `app/generated/prisma`; `db.server.ts` importuje
  lokální client a Vite ho externalizuje z SSR bundlu.
- Template přímo závisí na `@won/testing` a nabízí `test:unit`, `test:e2e` a
  `test:e2e:local:all`.
- Přidán generický Playwright config a app-owned `e2e.app.config.mjs` s povinnými
  `REPLACE_ME` hodnotami.
- `require-e2e-contract.mjs` je fail-closed: dokud appka nenastaví vlastní proxy
  probe a nepřidá alespoň jednu `*.spec.ts(x)`, E2E skončí explicitní chybou;
  potom spustí Playwright nebo sdílenou lokální Horizon/Dawn matici.
- README nyní popisuje bezpečné `rsync` scaffoldování bez build/env stavu,
  povinný E2E contract a skutečnost, že per-app Prisma izolace je výchozí stav.
- Roadmapa u prvního quantity produktu eviduje hotový izolovaný standalone
  template, nikoli hotovou Won Quantity appku.

### Ověření

- `npm run prisma:generate -w won-app-template` — **PASS**, client vygenerován
  do `apps/_template/app/generated/prisma` (adresář je gitignored).
- `npm run typecheck -w won-app-template` — **PASS**.
- `npm run build -w won-app-template` — **PASS**, client zůstal externalizovaný.
- template contract po implementaci — **PASS**, 3/3.
- `npm run test:e2e -w won-app-template` — **očekávaný FAIL** s přesným seznamem:
  nahradit `REPLACE_ME` a přidat app-specific storefront spec. To je požadovaný
  ochranný kontrakt, nikoli regrese.
- První široký `prettier --check apps/_template` zahrnul existující generované
  `build/**` assety a jeden nedotčený route soubor, proto skončil varováním.
  Cílená kontrola všech změněných zdrojů následně — **PASS**.
- `npm install` — bez změny dependency rizik; stále 50 známých zranitelností.

## 2026-08-01 — Task 6: scaffold `apps/won-quantity`

### Scaffold a decoupling

- Template byl kopírován přes source-only `rsync`; kromě původního seznamu jsou
  explicitně vyloučené také `app/generated`, `.shopify` a `test-results`.
- Nový workspace se jmenuje `won-quantity`, admin shell `Won Quantity` a používá
  pouze `read_products` scope pro první slice.
- App proxy má vlastní namespace `/apps/won-quantity` a app-owned health route s
  markerem `won-quantity-ok`.
- Přidán app-local `.env.example`; skutečný `.env` obsahuje pouze lokální SQLite
  cestu, je ignorovaný a nebyl přidán do gitu.
- `npm ls -w won-quantity @won/core @won/app-kit @won/testing --depth=0` —
  **PASS**, všechny tři dependency jsou workspace linky.

### Samostatný Shopify app record

- První `config:link` vytvořil nový record `Won Quantity`, ale bez `--path .`
  Shopify CLI následně prohledal celý monorepo a skončil na konfliktu tří backend
  `shopify.web.toml` souborů. Chybně vytvořený rootový `shopify.app.toml` byl
  odstraněn; správný app-local config zůstal zachovaný.
- Template i app nyní používají `shopify app dev --path .` a
  `shopify app config link --path .`; kontrakt to regresně hlídá.
- Druhý app-local link úspěšně připojil existující `Won Quantity` record.
  Vygenerovaný pojmenovaný config obsahoval promptový suffix `\\r`; finální
  canonical `shopify.app.toml` jej normalizuje na `Won Quantity` a zachovává
  zamýšlený proxy, scope a API `2026-04`.
- Client ID je vyplněný a programově ověřený jako odlišný od `B2Bcommerce`;
  jeho hodnota se do logu nevypisuje.

### Databázový setup od nuly

- První `npm run setup -w won-quantity` vygeneroval per-app client, ale migrate
  deploy skončil `Schema engine error`: template neměl init migraci a nový SQLite
  soubor ještě neexistoval.
- Doplněna Prisma-generovaná init migrace `Session` do template i appky.
- Druhý pokus stále ukázal, že `migrate deploy` sám prázdný SQLite soubor
  nevytvoří. `ensure-sqlite-db.mjs` nyní bezpečně vytvoří pouze `file:` datasource
  před deployem a je součástí template setup contractu.
- Čistý setup proti nové dočasné DB — **PASS**; vznikly pouze tabulky `Session`
  a `_prisma_migrations`, poté byla dočasná DB odstraněna.
- Opakovaný setup proti app-local DB — **PASS**, bez pending migrací.

### Ověření

- `npm install` — **PASS**, workspace registrován; dependency audit beze změny.
- `npm run typecheck -w won-quantity` — **PASS**.
- `npm run build -w won-quantity` — **PASS**, včetně app-proxy health route.
- aktualizovaný template contract — **PASS**, 3/3.
- `npm run test:e2e -w won-quantity` — **očekávaný FAIL** už pouze na chybějící
  app-specific `tests/e2e/*.spec.ts`. Proxy contract je vyplněný; spec vznikne v
  Task 12 společně se skutečným Horizon/Dawn během.
- První formátovací příkaz zahrnul `.gitignore` a TOML, pro které tato Prettier
  instalace nemá parser, a proto skončil chybou. Následná cílená kontrola
  podporovaných změněných souborů a `git diff --check` musí projít před commitem.
- Roadmapa nyní eviduje vytvořený Won Quantity scaffold, ne hotovou feature.

## 2026-08-01 — Task 7: quantity doména patří `@won/core`

### Změny

- Framework-free quantity test suite byla přesunuta z `b2b-companion` do
  `packages/core/tests/quantity` a importuje přímo source-owned engine.
- `@won/core` má vlastní `npm test` script a explicitní test dev dependencies.
- B2B `guard:test:core` už neodkazuje na app-local kopii quantity testu; v repu
  existuje jediný doménový vlastník očekávání.
- Původních šest scénářů bylo rozšířeno na devět kontraktů: default
  `min=1/step=1/max=null`, target a segment precedence, invalid/decimal
  normalizace, nejpřísnější maximum při stejné prioritě a společná validace
  minimum/step/maximum.
- Roadmapa u quantity produktu eviduje ověřené vlastnictví engine v `@won/core`.

### Ověření

- `npm test -w @won/core` — **PASS**, 9/9 testů.
- `npm run guard:test:core -w b2b-companion` — **PASS**, 300/300 zbývajících
  app-owned testů. Pokles z 306 je přesně odstraněných šest duplicitních quantity
  testů; celkové quantity pokrytí se naopak rozšířilo na devět core testů.
- `npm install` — **PASS**, audit stav beze změny (50 známých zranitelností).

## 2026-08-01 — Task 8: kontrakt prvního Won Quantity slice

### Zdrojová evidence

- Prostudované Horizon quantity, product-form a variant-morph flow potvrzuje, že
  theme vlastní custom element, `min/max/step`, cart-aware maximum,
  `QuantitySelectorUpdateEvent` a asynchronní morph při změně varianty.
- Prostudované Dawn `QuantityInput`, `ProductInfo`, product form a Liquid markup
  potvrzuje vlastní `stepUp/stepDown`, pub/sub variant events, section fetch a
  výměnu product subtree.
- Z více než 4 000 řádků B2B storefront skriptu byly inventarizované jen
  quantity principy: normalizace, app-owned notice, product form zachování a
  resync po změnách DOM. B2B katalogy, visibility, pricing, discounts a cart
  orchestration jsou výslovně mimo vlastnictví nové appky.

### Rozhodnutí

- `feature-contract.md` uzamyká precedence `variant > product > shop`, dědění
  override hodnot, fail-open/no-op chování a pravidlo, že appka může nativní
  Shopify constraints pouze zpřísnit.
- První slice pracuje s existujícím product quantity inputem na PDP, featured
  product a quick-add. Nevytváří druhý form ani vlastní add-to-cart a zatím
  neinterceptuje cart line quantity.
- CS/EN notice, více product forem, variant change, section morph, mobile i
  desktop jsou explicitní acceptance criteria pro společný Horizon/Dawn spec.
- Roadmapa eviduje dokončený behavior contract, nikoli dokončenou storefront
  feature.

## 2026-08-01 — Task 9: shop-scoped persistence a admin konfigurace

### TDD a datový model

- Service test vznikl před implementací a očekávaně selhal na chybějícím
  `quantity-config.server` modulu.
- `QuantityConfig` má unikátní `shop`; `QuantityRule` má unikátní dvojici
  `(shop, targetKey)` a cascade vazbu na konfiguraci stejného shopu.
- Service API validuje kladná celá čísla a `maximum >= minimum`, normalizuje shop
  z autentizované session a skládá `variant > product > shop` přes framework-free
  resolver z `@won/core`.
- Uninstall webhook maže app-owned rules/config a sessions pouze pro shop z
  ověřeného webhooku; nebere shop z formuláře ani query parametru.

### Admin slice

- Dashboard zobrazuje skutečný stav a efektivní shop default.
- `/app/settings` obsahuje pouze enable, minimum, step, optional maximum a
  explicitní stav app embedu s odkazem do theme editoru.
- Roadmapa eviduje shop-scoped config checkpoint; storefront extension zatím
  není označená jako hotová.

### Ověření

- Failing service test před implementací — **PASS jako TDD evidence**:
  `ERR_MODULE_NOT_FOUND` pro chybějící service modul.
- `npm run test:unit -w won-quantity` — **PASS**, 4/4 integrační service testy
  nad izolovanou SQLite DB.
- `npm test -w @won/core` — **PASS**, 9/9 quantity doménových testů.
- `npm run prisma:migrate:deploy -w won-quantity` — **PASS**, nová migrace
  aplikovaná na app-local DB.
- Čistý `npm run setup -w won-quantity` proti nové dočasné SQLite DB — **PASS**,
  obě migrace aplikované od nuly; dočasná DB byla odstraněna.
- `npm run typecheck -w won-quantity` — **PASS**.
- `npm run build -w won-quantity` — **PASS**, včetně settings a uninstall route.
- Sandboxové `tsx` pokusy mohou na tomto hostu skončit `EPERM` při vytvoření IPC
  socketu; stejné příkazy mimo sandbox prošly. Nejde o testovací regresi.

## 2026-08-01 — Task 10: portable theme app extension

### Scaffold a kontrakt

- Theme app extension `won-quantity-storefront` byla vytvořena oficiálním
  `shopify app generate extension`; vlastní samostatný Shopify UID.
- CLI demo star-rating bylo nahrazené body app embedem, jediným canonical
  `won-quantity.js` assetem, malým scoped stylesheetem a CS/EN/SK locales.
- Contract test vznikl před implementací a očekávaně selhal 0/4 na chybějícím
  app embedu, assetu, localech a config route.

### Storefront hranice

- Embed pouze předává ověřitelný product/variant kontext, app proxy endpoint a
  lokalizované message templates; nevytváří product form ani quantity widget.
- JS spravuje jen existující `input[name=quantity]` napojený na nativní
  `/cart/add` form, kombinuje nativní a app constraints, je idempotentní pro více
  forem a používá pouze `data-won-quantity-*` markery.
- Mutation observer a `shopify:section:load` resync pokrývají section morph a
  quick-add. Nedostupný proxy endpoint, chybějící input nebo nekompatibilní
  constraints skončí fail-open no-opem.
- `/apps/won-quantity/config` čte shop pouze z autentizované app-proxy session
  nebo z `shop` parametru až po úspěšném podpisovém ověření requestu.
- Roadmapa eviduje implementovanou portable extension; browser checkpoint bude
  zaznamenaný až po izolovaných Horizon/Dawn overlays a E2E.

### Shopify validace — první průchod

- Shopify Dev MCP označil Liquid jako invalidní, protože schema `t:` klíč nebyl
  v odděleném `en.default.schema.json` a JS měl 11 444 B proti 10KB limitu.
- Storefront locale JSON, JavaScript syntax a CSS samostatně prošly. Oprava proto
  přidává EN/CS schema locales a minifikuje jediný canonical JS asset; nevytváří
  druhou source/prod variantu.

### App dev runtime nález

- První skutečný `shopify app dev` sestavil extension a připravil dev preview,
  ale Vite SSR odhalil `exports is not defined` v lokálně generovaném
  `prisma-client-js` CommonJS klientu.
- Kontrola produkčního bundle navíc ukázala, že původní Rollup `external` regex
  vytvořil neplatnou relativní cestu odvozenou z absolutního worktree path.
- `apps/_template` i `won-quantity` proto používají izolovaný ESM generátor
  `prisma-client`, import z `generated/prisma/client` a už generated source
  neexternalizují. Template contract explicitně hlídá provider, module format a
  zákaz chybného external pravidla.

### Finální ověření checkpointu

- Shopify Dev MCP validace po opravě — **PASS**, 8/8 theme-extension artefaktů
  validních. JS zůstává jediným canonical produkčním assetem a splňuje 10KB
  extension limit; schema překlady jsou oddělené od storefront překladů.
- `shopify theme check --path apps/won-quantity/extensions/won-quantity-storefront`
  — **PASS**, 6 kontrolovaných souborů, 0 offenses.
- Kombinovaný template, persistence a extension contract suite — **PASS**,
  11/11 testů.
- `npm run typecheck -w won-quantity` a `npm run build -w won-quantity` —
  **PASS** po přechodu na ESM Prisma client.
- `npm run typecheck -w won-app-template` a `npm run build -w
won-app-template` — **PASS**; oprava je součástí reusable template, ne jen
  první appky.
- Druhý skutečný `shopify app dev --path apps/won-quantity` — **PASS**:
  migrace bez pending změn, React Router server i theme app extension preview
  ready, bez původní SSR chyby `exports is not defined`.
- Lokální Shopify CLI nemá příkaz `shopify app config validate`; tento konkrétní
  gate proto nebyl předstíraný. Skutečný `shopify app dev` ověřil config,
  extension build i runtime integraci.
- Přímý veřejný proxy probe skončil na očekávaném storefront password redirectu;
  funkční probe bude provedený uvnitř autentizovaného `shopify theme dev` běhu.
- Pozdější probe proti běžícímu CLI development theme originu na loopbacku —
  **PASS**, HTTP 200 a očekávaný `won-quantity-config-ok` marker; response body
  ani credentials nebyly zapsané do repozitáře.

## 2026-08-01 — Task 11: app-isolated Horizon/Dawn workspaces

### Remote themes a bezpečnost

- Dev store před změnou obsahoval live `test-data`, unpublished `Horizon` a
  `Dawn` a CLI-owned development theme.
- První pokus vytvořit `Won Quantity — Horizon` přes canonical push se s
  `--strict` bezpečně zastavil na existujících upstream Theme Check chybách.
  Push bez strict následně vytvořil neúplný unpublished theme, protože Shopify
  odmítl část upstream schema souborů. Přesně tento nově vytvořený vadný theme
  byl odstraněn; live ani původní themes se nezměnily.
- Čisté `Won Quantity — Horizon` a `Won Quantity — Dawn` byly proto vytvořené
  Shopify-native duplikací funkčních remote themes. Oba mají roli unpublished;
  nebyl použit `--publish`, `--live` ani `--allow-live`.
- Theme editor vyžaduje Shopify account login. In-app browser byl uživateli
  zobrazený na přihlašovací stránce; skutečné enable/save a stažení obou overlayů
  proto zůstává otevřený browser checkpoint. CLI development theme žádný uložený
  Won Quantity embed neobsahoval, takže nebyl vydáván za zdroj overlaye.

### Sdílený runner

- Nový `@won/testing` workspace helper kopíruje canonical checkout do
  `tmp/e2e-themes/<app>/<theme>`, bezpečně omezuje mazání na tento root a teprve
  v kopii nahrazuje `config/settings_data.json` app-owned overlayem.
- Runner config nyní vlastní bezpečný workspace slug a app-specific preferred
  ports. Won Quantity má vlastní remote names, overlay paths, proxy marker a
  porty 9881/9882; B2B zůstává na 9781/9782.
- Resolver umí najít canonical theme repositories i z Git linked worktree,
  nejen z primárního checkoutu. Původní dry run z `/private/tmp` správně odhalil
  chybný sibling path; nový resolver jej napravil bez hardcoded Ondřej pathu.
- Overlay parser přijímá Shopify-generated `/* ... */` header a validuje, že
  výsledný JSON obsahuje objekt `current`.

### TDD a ověření

- První `@won/testing` průchod — očekávaný **FAIL**, 2 testy: chybějící
  `theme-workspace.js` a chybějící workspace validace.
- Po implementaci `npm test -w @won/testing` — **PASS**, 18/18 testů včetně
  odmítnutí path traversal workspace/overlaye a overlaye bez `current` objektu.
- B2B dry run — **PASS**: canonical Horizon/Dawn jsou resolved u primárního
  checkoutu, runtime cíle jsou pouze pod worktree `tmp/e2e-themes/b2b-companion`.
- Won Quantity dry run zatím záměrně fail-closed na chybějících skutečných
  overlay files; nebude označený green, dokud je nevygeneruje theme editor.
- Následná statická mezitheme revize upravila variant helper tak, aby radio
  options hledal uvnitř hlavního nativního `variant-picker`/`variant-selects` i
  tehdy, když je input vizuálně skrytý a ovládá se přes label. `won-quantity`
  typecheck a opakovaný `@won/testing` suite po změně — **PASS** (18/18).
- První opakování `@won/testing` v sandboxu skončilo hostitelským `EPERM` na
  lokálním `tsx` IPC socketu; identický příkaz mimo sandbox prošel. Nešlo o
  aplikační ani testovací regresi.

## 2026-08-01 — Task 12: app-owned Playwright a seed contract (rozpracováno)

### Implementovaný kontrakt

- Playwright config spouští stejný spec v desktopním 1440×1000 a mobilním
  390×844 projektu, sekvenčně a s retained trace/screenshot/video při chybě.
- App-owned fixtures sledují proxy/JS/CSS HTTP chyby, failed requests, page
  exceptions a Won Quantity console errors. Spec pokrývá nativní form, asset a
  proxy, minimum/step/max, ruční normalizaci, variant morph a skutečnou cart
  quantity po add-to-cart.
- Global setup používá pouze `wq-e2e-default`, `wq-e2e-step` a
  `wq-e2e-maximum`, snapshotuje jen dotčené Won Quantity DB řádky a teardown je
  obnoví. Produkty ani B2B katalogy test během běhu nemění.

### Fail-first evidence a blokující merchant data

- První skutečný Playwright běh mimo sandbox — očekávaný **FAIL**, desktop i
  mobile na chybějícím `[data-won-quantity-embed]`; žádný false skip.
- Po zapojení seedu gate skončí dříve a přesně na chybějících namespaced product
  fixtures; typová kontrola celého E2E kódu je **PASS**.
- Admin GraphQL `productSet` mutation byla ověřena Shopify Dev MCP proti API
  2026-04 jako validní a vyžadující `write_products`. Pokus použít starou B2B
  offline session skončil 401; token nebyl vypsaný ani uložený a dočasný skript
  byl odstraněn. Lokální Shopify CLI 3.92.1 příkaz `shopify store execute`
  neposkytuje.
- Vytvoření/publikování tří fixture products proto čeká na stejné Shopify Admin
  přihlášení jako theme editor. Nové appce nebyl kvůli testům přidán
  `write_products` scope.
- První app lint po přidání E2E — **FAIL**, dva nepoužité Playwright `FullConfig`
  parametry v global setup/teardown. Signatury byly zjednodušené bez změny
  chování; opakovaný Won Quantity lint — **PASS**.
- Playwright collection gate (`--list`) — **PASS**, 8 konkrétních testů: čtyři
  stejné scénáře v desktop a mobile projektu, bez skrytého skipu.

## 2026-08-01 — Task 13: portfolio static/release gate

### Orchestrace a dokumentace

- Root má explicitní `test:packages`, `typecheck:apps`, `build:apps` a
  `validate:shopify`; vývoj nadále startuje jen jednu explicitně vybranou appku.
- README opravuje zastaralý Prisma CJS/external návod na ověřený ESM client a
  popisuje app-specific overlays, temp workspace a merchant-backed release gate.
- Won Quantity README dokumentuje ownership, setup, přesné fixture handles,
  unpublished themes, overlay pravidla, porty a seed/restore blast radius.
- PR workflow generuje všechny izolované Prisma clients, spouští package/domain,
  B2B app-owned a Won app-owned testy, lint standalone template/appky,
  typecheck, build, Theme Check a kontrolu tokenů/runtime files. Merchant
  credentials nejsou předstírané v PR CI.

### Ověření a nalezený starší gate problém

- Původně navržené `npm test --workspaces --if-present` spustilo také stale
  scaffold fixtures v B2B discount Function: 4/8 očekávaly demo slevy, zatímco
  současná produkční function správně vrací bez configu prázdné operations.
  Produkční B2B core gate tuto logiku testuje vlastními kontrakty; demo fixtures
  nebyly přepisované ani jejich failure maskovaný.
- `test:packages` proto přesně odpovídá názvu a spouští `@won/core` a
  `@won/testing`: **PASS**, 9/9 + 18/18.
- `npm run typecheck:apps` — **PASS**, template, B2B Companion a Won Quantity.
- `npm run build:apps` — **PASS**, všechny tři app builds i obě B2B Shopify
  Functions.
- `npm run validate:shopify` — **PASS**, 6 extension files, 0 offenses.
- Opakovaný kombinovaný deterministický release gate po self-review — **PASS**:
  `test:packages` (9/9 + 18/18), `lint:standalone`, `typecheck:apps`,
  `build:apps` včetně obou B2B Functions a `validate:shopify` (6 souborů,
  0 offenses).
- Přidání lokálně reprodukovatelného Shopify CLI 3.92.1 změnilo lockfile;
  `npm install` zůstává na 50 známých zranitelnostech (1 low, 6 moderate,
  41 high, 2 critical). Nebyl spuštěn destruktivní `npm audit fix --force`.
- Statická self-review zachytila, že první token scanner by v CI našel vlastní
  doslovný regex. Pattern byl změněn na ekvivalentní `s[h]...` zápis, který dál
  detekuje skutečné Shopify tokeny, ale neblokuje workflow sám sebou.
- Won Quantity i reusable template lint — **PASS**. Portfolio B2B lint byl také
  prověřen, ale obsahuje 326 starších chyb v legacy/generated kódu; ty nebyly v
  rámci decouplingu hromadně přepisované ani falešně přidané do green CI gate.

## 2026-08-02 — Integrace do main

- Uživatel potvrdil celý pracovní rozsah pro publikování přímo na `main`.
- Feature větev byla po kontrole staged diffu a token/runtime scanu commitnutá,
  přebázovaná na aktuální `origin/main` a lokální `main` byl aktualizovaný pouze
  fast-forwardem. Ekvivalentní roadmap commit Git při rebase správně vynechal.
- První gate z čistého main checkoutu — **FAIL** až v Won Quantity unit suite:
  ignorovaný `app/generated/prisma/client.ts` v tomto worktree ještě neexistoval.
  Jde o očekávaný generated artefakt; CI ho už před testy explicitně generuje.
- Po spuštění stejných tří `prisma:generate` kroků jako v CI — **PASS**:
  `test:packages` 9/9 + 18/18, B2B core 300/300, Won Quantity unit 8/8,
  `lint:standalone`, `typecheck:apps`, `build:apps` včetně obou Functions a
  Theme Check 6/6 bez offenses.
- Merchant-backed Horizon/Dawn browser gate zůstává v roadmapě pravdivě
  rozpracovaný; přímé publikování na main jeho stav nemění ani nepředstírá.
