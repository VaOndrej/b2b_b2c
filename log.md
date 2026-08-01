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
