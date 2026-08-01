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
