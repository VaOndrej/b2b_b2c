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
