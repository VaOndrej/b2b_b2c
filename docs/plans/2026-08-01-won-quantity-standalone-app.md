# Won Quantity Standalone App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Vytvořit první novou standalone Shopify aplikaci `won-quantity` z existující monorepo šablony, znovu použít quantity know-how z `b2b-companion` a ověřovat stejný storefront build na dev storu proti Horizon i Dawn.

**Architecture:** Každá appka má vlastní Shopify app record, konfiguraci, databázi, theme app extension a release lifecycle. Sdílené doménové chování zůstává v `@won/core`, Shopify plumbing v `@won/app-kit` a `@won/shopify-adapter`; nový `@won/testing` převezme pouze generický Horizon/Dawn test harness. App-specific seedování, proxy endpointy, DOM markery a scénáře zůstávají uvnitř `apps/won-quantity`.

**Tech Stack:** npm workspaces, Shopify CLI 3.x, React Router 7, TypeScript, Prisma 6, Shopify theme app extension, Liquid, vanilla JavaScript, Playwright, `node:test` přes `tsx`, Horizon a Dawn na jednom development storu.

---

## Výchozí předpoklad

Plán používá `Won Quantity` jako referenční první appku, protože:

- je první distribuční wedge v produktové roadmapě;
- `@won/core` už obsahuje `quantity.engine.ts` a `quantity.rules.ts`;
- `b2b-companion` už obsahuje storefront chování a Horizon/Dawn testovací zkušenosti;
- funkcionalita se dá dodat theme app extension bez ruční úpravy merchantova theme kódu.

Pokud se jako první zvolí jiná appka, Tasks 1–5 zůstávají stejné. Mění se až app-specific doména, extension a E2E scénáře od Task 6.

## Co už je připravené

- `apps/_template` je funkční React Router Shopify app skeleton.
- `@won/app-kit` sdílí autentizaci, SSR, root shell a lifecycle webhooks.
- `@won/core` obsahuje framework-free quantity engine.
- `@won/shopify-adapter` je určený pro Shopify GraphQL, metafields a webhook plumbing.
- Dev store už používá Horizon a Dawn checkouty v `../b2b_b2c_themes/{Horizon,Dawn}`.
- `b2b-companion` už má Playwright theme matrix a lokální dvoutheme runner.

## Co ještě připravené není

1. E2E harness není sdílený. Je v `apps/b2b-companion` a obsahuje pevné vazby na MarginGuard, `mg_e2e_audience`, konkrétní app proxy a testovací katalog.
2. Po přesunu do monorepa hledá `test-e2e-local-all.mjs` theme checkouty pod `apps/b2b_b2c_themes`, ale skutečné checkouty jsou vedle kořene repa. Dnešní defaultní cesta je tedy rozbitá.
3. `apps/_template` používá hoisted `@prisma/client`; druhá DB appka by při `prisma generate` mohla přepsat klienta `b2b-companion`.
4. Root `build`, `typecheck` a `guard:test` stále delegují jen do `b2b-companion`.
5. Horizon/Dawn `config/settings_data.json` dnes obsahuje app embed `b2bcommerce`. Testy nové appky potřebují vlastní izolovaný embed overlay, jinak by se appky při testování ovlivňovaly.

## Cílové rozdělení odpovědností

```text
packages/core
  quantity pravidla, normalizace a validace bez Shopify/DOM závislostí

packages/app-kit
  Shopify app factory, auth, session storage, SSR a webhooks

packages/shopify-adapter
  Admin GraphQL, metafields a Shopify integrační adaptéry

packages/testing
  Horizon/Dawn projekty, theme guard, standardní selektory,
  theme-dev orchestrace, console/network evidence

apps/won-quantity
  vlastní Shopify app config a DB
  admin UI a služby
  theme app extension
  app proxy
  app-specific seed/cleanup a E2E scénáře
```

## Testovací vrstvy

| Vrstva | Umístění | Co chrání |
| --- | --- | --- |
| Domain unit | `packages/core/tests/quantity/*` | min/step/max a precedence pravidel |
| App unit/integration | `apps/won-quantity/tests/*` | shop-scoped config, persistence a proxy response |
| Extension contract | `apps/won-quantity/tests/contracts/*` | Liquid schema, assets, lokalizace a stabilní DOM markery |
| Storefront E2E | `apps/won-quantity/tests/e2e/*` | stejné chování na Horizon i Dawn |
| Static release gates | app workspace scripts | typecheck, build, theme validation a secret/config guardy |

---

### Task 0: Založit izolovanou implementační větev a změřit baseline

**Files:**
- Read: `package.json`
- Read: `apps/_template/package.json`
- Read: `apps/b2b-companion/package.json`
- Read: `apps/b2b-companion/tests/e2e/README.md`

**Step 1: Zkontrolovat pracovní strom**

Run:

```bash
git status --short
```

Expected: jsou vidět pouze vědomé dokumentační změny; žádná existující změna se nezahazuje.

**Step 2: Vytvořit dedikovaný worktree**

Run z čistého commitu:

```bash
git worktree add ../b2b_b2c-won-quantity -b codex/won-quantity-bootstrap
```

Expected: nový worktree je na větvi `codex/won-quantity-bootstrap`.

**Step 3: Ověřit současný baseline**

Run:

```bash
npm run guard:test:core -w b2b-companion
npm run typecheck -w won-app-template
npm run build -w won-app-template
```

Expected: všechny tři příkazy projdou před změnou infrastruktury.

**Step 4: Reprodukovat rozbitou theme cestu**

Run:

```bash
npm run test:e2e:local:all -w b2b-companion -- --dry-run
```

Expected před opravou: runner hlásí, že theme checkout pod `apps/b2b_b2c_themes` neexistuje.

**Step 5: Commit baseline poznámky pouze pokud vznikly**

```bash
git add docs
git commit -m "docs: record standalone app baseline"
```

---

### Task 1: Vytvořit `@won/testing` a opravit rozlišení theme checkoutů

**Files:**
- Create: `packages/testing/package.json`
- Create: `packages/testing/src/theme-paths.ts`
- Create: `packages/testing/tests/theme-paths.test.ts`
- Modify: `tsconfig.base.json`

**Step 1: Napsat failing test na monorepo-relative cesty**

Test musí ověřit, že pro repo root `/repo/b2b_b2c` vzniknou:

```ts
{
  horizon: "/repo/b2b_b2c_themes/Horizon",
  dawn: "/repo/b2b_b2c_themes/Dawn",
}
```

a že env `SHOPIFY_E2E_THEME_DIR_HORIZON` nebo `SHOPIFY_E2E_THEME_DIR_DAWN` má přednost.

**Step 2: Spustit test a ověřit, že padá**

Run:

```bash
npx tsx --test packages/testing/tests/theme-paths.test.ts
```

Expected: FAIL, protože `resolveThemePaths` ještě neexistuje.

**Step 3: Přidat package manifest**

`packages/testing/package.json`:

```json
{
  "name": "@won/testing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./theme-paths": "./src/theme-paths.ts",
    "./playwright": "./src/playwright/index.ts"
  },
  "dependencies": {
    "@playwright/test": "^1.58.2"
  },
  "devDependencies": {
    "@types/node": "^22.18.8",
    "tsx": "^4.19.2",
    "typescript": "^5.9.3"
  }
}
```

**Step 4: Implementovat resolver**

Resolver přijímá explicitní `repoRoot`, používá `path.resolve(repoRoot, "../b2b_b2c_themes")` a až potom aplikuje env overrides. Nesmí odvozovat cesty od app workspace.

**Step 5: Přidat TypeScript alias**

Do `tsconfig.base.json` přidat:

```json
"@won/testing/*": ["packages/testing/src/*"]
```

**Step 6: Spustit test**

Run:

```bash
npx tsx --test packages/testing/tests/theme-paths.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/testing tsconfig.base.json package-lock.json
git commit -m "test: add shared theme checkout resolver"
```

---

### Task 2: Vytáhnout generickou Horizon/Dawn Playwright vrstvu

**Files:**
- Create: `packages/testing/src/playwright/theme.ts`
- Create: `packages/testing/src/playwright/test-base.ts`
- Create: `packages/testing/src/playwright/theme-dev-mime.ts`
- Create: `packages/testing/src/playwright/index.ts`
- Create: `packages/testing/tests/theme-context.test.ts`
- Read: `apps/b2b-companion/tests/e2e/support/theme.ts`
- Read: `apps/b2b-companion/tests/e2e/support/test-base.ts`
- Read: `apps/b2b-companion/tests/e2e/support/theme-dev-mime.ts`

**Step 1: Napsat test generického theme contextu**

Ověřit:

- `ThemeName` dovoluje pouze `horizon | dawn`;
- Dawn přidá `preview_theme_id` pouze v remote režimu;
- local theme-dev režim nepřidá preview ID;
- společné selektory najdou nativní product form, `input[name=quantity]` a add-to-cart submit;
- volitelný app-specific `decoratePath` může přidat vlastní query parametr, ale generická vrstva nezná `mg_e2e_audience`.

**Step 2: Spustit failing test**

```bash
npx tsx --test packages/testing/tests/theme-context.test.ts
```

Expected: FAIL, exporty ještě neexistují.

**Step 3: Přenést pouze generické části**

Do `@won/testing` patří:

- `ThemeName`, `ThemeSelectors`, `ThemeContext`;
- shared selectors s per-theme override mapou;
- kontrola `window.Shopify.theme`;
- `gotoStorefront`;
- local theme-dev MIME shim;
- Playwright `test` base fixture.

Do `@won/testing` nepatří:

- MarginGuard katalog, audience tag a query param;
- `MARGIN_GUARD_E2E_OVERRIDE`;
- app proxy URL;
- MarginGuard DOM ID;
- app-specific seed a cleanup.

**Step 4: Spustit testy balíčku**

```bash
npx tsx --test packages/testing/tests/*.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/testing package-lock.json
git commit -m "test: extract reusable Horizon and Dawn fixtures"
```

---

### Task 3: Parametrizovat dvoutheme runner

**Files:**
- Create: `packages/testing/scripts/run-theme-matrix.mjs`
- Create: `packages/testing/tests/runner-config.test.ts`
- Create: `apps/b2b-companion/e2e.app.config.mjs`
- Modify: `apps/b2b-companion/package.json`
- Reference: `apps/b2b-companion/scripts/test-e2e-local-all.mjs`

**Step 1: Definovat app-owned config contract**

`apps/b2b-companion/e2e.app.config.mjs` musí exportovat:

```js
export default {
  appName: "b2b-companion",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/margin-guard/visibility-script",
    bodyMarker: "DEFAULT_PROXY_PREFIX",
  },
  testCommand: ["node", "./scripts/run-playwright-e2e.mjs"],
  themes: {
    horizon: { remoteName: "Horizon" },
    dawn: { remoteName: "Dawn" },
  },
};
```

**Step 2: Napsat failing config test**

Ověřit chybové stavy: chybějící `appProxyProbe.path`, theme adresář bez `layout/theme.liquid`, neplatný port a neznámé `--only`.

**Step 3: Implementovat generický runner**

Runner musí:

1. načíst app config předaný přes `--config`;
2. rozlišit theme cesty relativně k repo rootu;
3. spouštět Horizon a Dawn sekvenčně;
4. pro každý theme použít volný port;
5. čekat na zdravý local origin;
6. provést konfigurovatelný app-proxy preflight;
7. spustit app-specific test command;
8. vždy ukončit vlastní `shopify theme dev` proces;
9. neměnit originální theme checkout.

**Step 4: Přepojit b2b script**

`apps/b2b-companion/package.json`:

```json
"test:e2e:local:all": "node ../../packages/testing/scripts/run-theme-matrix.mjs --config ./e2e.app.config.mjs"
```

**Step 5: Ověřit dry run**

```bash
npm run test:e2e:local:all -w b2b-companion -- --dry-run
```

Expected:

- Horizon checkout: `../b2b_b2c_themes/Horizon`;
- Dawn checkout: `../b2b_b2c_themes/Dawn`;
- žádná chyba `theme directory not found`;
- nevznikne žádný child process.

**Step 6: Commit**

```bash
git add packages/testing apps/b2b-companion/e2e.app.config.mjs apps/b2b-companion/package.json
git commit -m "test: parameterize local storefront theme matrix"
```

---

### Task 4: Prokázat sdílení migrací `b2b-companion` na `@won/testing`

**Files:**
- Modify: `apps/b2b-companion/tests/e2e/support/theme.ts`
- Modify: `apps/b2b-companion/tests/e2e/support/test-base.ts`
- Modify: `apps/b2b-companion/tests/e2e/support/fixtures.ts`
- Modify: `apps/b2b-companion/package.json`

**Step 1: Nahradit duplikované generické implementace importy**

`theme.ts` má zůstat tenký app-specific adaptér:

- importuje `createThemeContext` a shared selectors z `@won/testing/playwright`;
- přidává pouze `base | catalog` context a `mg_e2e_audience` dekoraci;
- zachovává dnešní MarginGuard theme guard chování.

**Step 2: Spustit typecheck**

```bash
npm run typecheck -w b2b-companion
```

Expected: PASS.

**Step 3: Spustit core/contract gate**

```bash
npm run guard:test:core -w b2b-companion
```

Expected: stejný počet testů jako baseline, 0 failures.

**Step 4: Spustit lokální dvoutheme E2E**

Terminal A:

```bash
MARGIN_GUARD_E2E_OVERRIDE=1 npm run dev -w b2b-companion
```

Terminal B:

```bash
npm run test:e2e:local:all -w b2b-companion -- --bail
```

Expected: Horizon PASS, Dawn PASS; runner po sobě nezanechá theme-dev proces.

**Step 5: Commit**

```bash
git add apps/b2b-companion packages/testing
git commit -m "refactor: consume shared storefront test harness"
```

---

### Task 5: Zpevnit `apps/_template` pro druhou standalone appku

**Files:**
- Modify: `apps/_template/prisma/schema.prisma`
- Modify: `apps/_template/app/db.server.ts`
- Modify: `apps/_template/vite.config.ts`
- Modify: `apps/_template/package.json`
- Create: `apps/_template/e2e.app.config.mjs`
- Modify: `README.md`

**Step 1: Napsat contract test template**

Create: `packages/testing/tests/app-template.contract.test.ts`.

Test musí vyžadovat:

- per-app Prisma output;
- `@won/testing` dependency;
- `test:unit`, `test:e2e` a `test:e2e:local:all` scripts;
- žádný vyplněný `client_id`;
- žádný hardcoded MarginGuard název, proxy nebo env flag.

**Step 2: Ověřit, že test padá**

```bash
npx tsx --test packages/testing/tests/app-template.contract.test.ts
```

Expected: FAIL na hoisted Prisma output a chybějících test scripts.

**Step 3: Izolovat Prisma client**

`apps/_template/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../app/generated/prisma"
}
```

`apps/_template/app/db.server.ts` musí importovat `PrismaClient` z `./generated/prisma`.

`apps/_template/vite.config.ts` musí externalizovat per-app generated client podle již zdokumentovaného regexu.

**Step 4: Přidat test hooks bez app-specific scénářů**

Template má ukázat kontrakt, ale nemá obsahovat falešně zelené E2E testy. `test:e2e` má selhat s jasnou zprávou, dokud nová appka nepřidá vlastní spec a proxy probe.

**Step 5: Ověřit template**

```bash
npm run prisma:generate -w won-app-template
npm run typecheck -w won-app-template
npm run build -w won-app-template
npx tsx --test packages/testing/tests/app-template.contract.test.ts
```

Expected: vše PASS a generovaný Prisma client je pouze pod `apps/_template/app/generated/prisma`.

**Step 6: Commit**

```bash
git add apps/_template packages/testing/tests README.md package-lock.json
git commit -m "build: harden standalone app template"
```

---

### Task 6: Scaffoldovat `apps/won-quantity`

**Files:**
- Create: `apps/won-quantity/**`
- Modify: `package-lock.json`
- Optionally modify: `package.json`

**Step 1: Kopírovat pouze zdrojové soubory template**

```bash
rsync -a \
  --exclude build \
  --exclude .react-router \
  --exclude .env \
  --exclude node_modules \
  apps/_template/ apps/won-quantity/
```

Expected: nový workspace neobsahuje generated build, lokální `.env` ani Shopify state.

**Step 2: Přejmenovat appku**

Upravit:

- `apps/won-quantity/package.json` → `"name": "won-quantity"`;
- `apps/won-quantity/shopify.app.toml` → `name = "Won Quantity"`;
- scope ponechat na minimu nutném pro MVP;
- app proxy použít unikátní `prefix = "apps"`, `subpath = "won-quantity"`.

**Step 3: Registrovat workspace dependency graph**

```bash
npm install
```

Expected: `npm ls -w won-quantity @won/core @won/app-kit @won/testing` ukáže workspace links.

**Step 4: Vytvořit samostatný Shopify app record**

```bash
npm run config:link -w won-quantity
```

Expected: vybere se nový app record `Won Quantity`, nikoli `B2Bcommerce`; `client_id` je unikátní.

**Step 5: Vytvořit app-local env a databázi**

```bash
cp apps/won-quantity/.env.example apps/won-quantity/.env
npm run setup -w won-quantity
```

Expected: Prisma generuje klienta pod `apps/won-quantity/app/generated/prisma` a nevstoupí do klienta `b2b-companion`.

**Step 6: Ověřit prázdnou appku**

```bash
npm run typecheck -w won-quantity
npm run build -w won-quantity
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/won-quantity package.json package-lock.json
git commit -m "feat: scaffold Won Quantity standalone app"
```

---

### Task 7: Přesunout quantity doménové testy k jejich skutečnému vlastníkovi

**Files:**
- Create: `packages/core/tests/quantity/quantity-engine.test.ts`
- Modify: `packages/core/package.json`
- Reference: `apps/b2b-companion/tests/quantity/quantity-engine.test.ts`
- Modify: `apps/b2b-companion/package.json`

**Step 1: Přenést framework-free testy bez změny očekávání**

Testy musí pokrýt:

- default `min=1`, `step=1`, `max=null`;
- product rule má přednost před collection a global rule;
- segment-specific rule má přednost na stejné target úrovni;
- maximum používá nejpřísnější hodnotu při shodné prioritě;
- neplatné hodnoty se normalizují;
- quantity pod minimum, mimo step nebo nad maximum neprojde.

**Step 2: Přidat package script**

`packages/core/package.json`:

```json
"scripts": {
  "test": "tsx --test tests/**/*.test.ts"
}
```

**Step 3: Spustit core testy**

```bash
npm test -w @won/core
```

Expected: PASS.

**Step 4: Odstranit duplicate ownership z b2b scriptu**

`b2b-companion` může core test spouštět jako workspace dependency, ale nesmí udržovat druhou kopii stejného quantity testu.

**Step 5: Commit**

```bash
git add packages/core apps/b2b-companion/package.json
git commit -m "test: move quantity domain coverage to won core"
```

---

### Task 8: Definovat první vertical slice místo kopírování theme kódu

**Files:**
- Create: `apps/won-quantity/docs/feature-contract.md`
- Read: konkrétní theme soubory, ze kterých se feature převádí
- Read: `apps/b2b-companion/app/routes/margin-guard.visibility-script.tsx`
- Read: `packages/core/src/quantity/quantity.engine.ts`

**Step 1: Sepsat behavior inventory**

Pro každý přenášený behavior zapsat:

- vstupní data;
- viditelný výsledek;
- fallback bez dat;
- product/variant/cart surface;
- desktop/mobile;
- lokalizace;
- co je nativní Shopify/theme chování a nesmí se nahradit.

**Step 2: Vymezit MVP**

První slice:

1. globální `enabled`;
2. product/variant `minimum`, `step`, volitelný `maximum`;
3. zobrazení pravidla u nativního quantity inputu;
4. zachování nativního product form a add-to-cart flow;
5. funkčnost po variant change a Shopify section morph;
6. čeština a angličtina;
7. Horizon a Dawn.

Mimo první slice: segmentace, pricing, visibility, discount orchestration a B2B catalogy.

**Step 3: Zakázat slepé kopírování**

`feature-contract.md` musí výslovně uvést, že se nekopíruje celý více než 4 000řádkový MarginGuard storefront script. Přenáší se pouze prokázané quantity chování a stabilní testy.

**Step 4: Commit**

```bash
git add apps/won-quantity/docs/feature-contract.md
git commit -m "docs: define Won Quantity vertical slice"
```

---

### Task 9: Přidat shop-scoped persistence a admin konfiguraci

**Files:**
- Modify: `apps/won-quantity/prisma/schema.prisma`
- Create: `apps/won-quantity/app/services/quantity-config.server.ts`
- Create: `apps/won-quantity/app/routes/app.settings.tsx`
- Modify: `apps/won-quantity/app/routes/app._index.tsx`
- Create: `apps/won-quantity/tests/services/quantity-config.server.test.ts`

**Step 1: Napsat failing service test**

Ověřit, že:

- dva shopy nikdy nesdílejí konfiguraci;
- `minimum >= 1`, `step >= 1`;
- `maximum` je `null` nebo `>= minimum`;
- product/variant override dědí globální fallback;
- uninstall cleanup maže pouze data daného shopu.

**Step 2: Přidat modely s povinným `shop` scope**

Použít samostatný config řádek na shop a pravidla s jednoznačným `targetKey`, například `product:<gid>` nebo `variant:<gid>`. Nevytvářet singleton `id="default"` sdílený mezi shopy.

**Step 3: Implementovat minimální service API**

```ts
getQuantityConfig(shop)
updateQuantityConfig(shop, input)
resolveQuantityRule(shop, productGid, variantGid)
deleteShopData(shop)
```

**Step 4: Implementovat jednu settings page**

Admin UI má pro první slice pouze:

- enable/disable;
- default minimum;
- default step;
- optional maximum;
- jasný stav „App embed active / needs activation“;
- odkaz na theme editor activation.

**Step 5: Spustit testy, migraci a build**

```bash
npm run prisma:generate -w won-quantity
npm run prisma:migrate:deploy -w won-quantity
npx tsx --test apps/won-quantity/tests/services/quantity-config.server.test.ts
npm run typecheck -w won-quantity
npm run build -w won-quantity
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/won-quantity
git commit -m "feat: add shop-scoped quantity configuration"
```

---

### Task 10: Vygenerovat a implementovat theme app extension

**Files:**
- Create through Shopify CLI: `apps/won-quantity/extensions/won-quantity-storefront/**`
- Create: `apps/won-quantity/app/routes/won-quantity.config.tsx`
- Modify: `apps/won-quantity/shopify.app.toml`
- Create: `apps/won-quantity/tests/contracts/theme-extension.contract.test.ts`

**Step 1: Vygenerovat extension oficiálním CLI**

Run z app workspace:

```bash
cd apps/won-quantity
shopify app generate extension
```

V interaktivním výběru zvolit `Theme app extension` a jméno `won-quantity-storefront`.

Expected: vznikne standardní `assets/`, `blocks/`, `snippets/`, `locales/`, `package.json` a `shopify.extension.toml` se samostatným UID.

**Step 2: Napsat failing extension contract**

Test musí vyžadovat:

- app embed block;
- static asset `won-quantity.js`;
- stabilní marker `[data-won-quantity-embed]`;
- localized schema a storefront labels v `en.default` a `cs`;
- žádný MarginGuard marker nebo proxy path;
- žádné duplikované add-to-cart form;
- unikátní `/apps/won-quantity` proxy prefix.

**Step 3: Implementovat app embed**

Embed má:

- načíst jeden static JS asset přes extension schema;
- vložit minimální bootstrap s product/variant identitou;
- zachovat nativní `form[action*='/cart/add']` a `input[name='quantity']`;
- neobsahovat Horizon-only ani Dawn-only markup;
- mít bezpečný no-op fallback, když quantity input na stránce není.

**Step 4: Implementovat app proxy config endpoint**

Route používá `authenticate.public.appProxy(request)`, získá shop, product a variant context a vrátí pouze normalizované:

```json
{
  "enabled": true,
  "minimum": 3,
  "step": 3,
  "maximum": 12,
  "messages": {
    "minimum": "Minimum: 3",
    "step": "Sold in multiples of 3"
  }
}
```

Endpoint nesmí přijmout shop z neověřeného query parametru jako autoritu.

**Step 5: Implementovat storefront enhancement**

JS musí:

- najít nativní quantity input přes shared contract;
- respektovat existující Shopify `min`, `max`, `step` a aplikovat přísnější kombinaci;
- aktualizovat plus/minus a ruční vstup bez vytvoření druhého formu;
- dispatchnout nativní `input` a `change` eventy;
- přežít variant change, quick-add a section morph;
- podporovat více product forms na jedné stránce;
- používat app-owned `data-won-quantity-*` markery;
- odstranit své markery/listenery při disable nebo re-renderu;
- neblokovat storefront při nedostupném app proxy.

**Step 6: Ověřit contract, typecheck a build**

```bash
npx tsx --test apps/won-quantity/tests/contracts/theme-extension.contract.test.ts
npm run typecheck -w won-quantity
npm run build -w won-quantity
```

Expected: PASS.

**Step 7: Validovat extension přes Shopify tooling**

```bash
shopify app dev --path apps/won-quantity
```

Expected: CLI extension sestaví a nabídne preview bez config/schema chyby.

**Step 8: Commit**

```bash
git add apps/won-quantity
git commit -m "feat: add portable quantity theme app extension"
```

---

### Task 11: Izolovat Horizon/Dawn test theme overlay pro novou appku

**Files:**
- Create: `apps/won-quantity/tests/themes/horizon.settings_data.json`
- Create: `apps/won-quantity/tests/themes/dawn.settings_data.json`
- Create: `apps/won-quantity/e2e.app.config.mjs`
- Modify: `packages/testing/scripts/run-theme-matrix.mjs`
- Modify: `.gitignore`

**Step 1: Vytvořit dva app-specific unpublished remote themes**

Na dev storu vytvořit:

- `Won Quantity — Horizon`;
- `Won Quantity — Dawn`.

Nikdy je nepublikovat. Runner nesmí používat `--allow-live`.

**Step 2: Aktivovat Won Quantity embed přes theme editor**

Pro každý theme:

1. spustit preview nové appky;
2. otevřít App embeds;
3. zapnout pouze `Won Quantity` embed;
4. uložit;
5. stáhnout odpovídající `config/settings_data.json` jako app-specific overlay.

Overlay se nesmí ručně skládat z vymyšleného extension UUID.

**Step 3: Rozšířit runner o dočasný theme workspace**

Pro každý běh runner:

1. vytvoří `tmp/e2e-themes/won-quantity/<theme>`;
2. zkopíruje canonical Horizon/Dawn checkout;
3. aplikuje pouze app-specific `settings_data.json` overlay;
4. spustí `shopify theme dev` z dočasné kopie;
5. po běhu proces ukončí;
6. runtime kopii nechá ignorovanou a bezpečně přepsatelnou při dalším běhu.

Tím se testovací konfigurace `b2b-companion` a `won-quantity` navzájem nekontaminují.

**Step 4: Definovat Won Quantity runner config**

Config musí mít:

- workspace `won-quantity`;
- remote theme names z kroku 1;
- proxy probe `/apps/won-quantity/config`;
- body marker specifický pro Won Quantity;
- test command appky;
- vlastní port preferences;
- žádný MarginGuard env flag.

**Step 5: Ověřit dry run**

```bash
npm run test:e2e:local:all -w won-quantity -- --dry-run
```

Expected: oba canonical checkouty existují, oba overlays existují, cílové remote themes jsou unpublished a temp paths jsou pod root `tmp/`.

**Step 6: Commit**

```bash
git add apps/won-quantity packages/testing .gitignore
git commit -m "test: isolate Won Quantity theme matrix overlays"
```

---

### Task 12: Přidat app-specific seed a Horizon/Dawn E2E scénáře

**Files:**
- Create: `apps/won-quantity/playwright.config.ts`
- Create: `apps/won-quantity/tests/e2e/support/fixtures.ts`
- Create: `apps/won-quantity/tests/e2e/support/seed.ts`
- Create: `apps/won-quantity/tests/e2e/global.setup.ts`
- Create: `apps/won-quantity/tests/e2e/global.teardown.ts`
- Create: `apps/won-quantity/tests/e2e/storefront.quantity.spec.ts`
- Modify: `apps/won-quantity/package.json`

**Step 1: Definovat namespaced test data**

Použít dedikované produkty nebo stabilní handly:

- `wq-e2e-default`;
- `wq-e2e-step`;
- `wq-e2e-maximum`.

Testovací config musí být shop-scoped a app-scoped. Nepoužívat `mg-e2e-*` produkty ani MarginGuard katalog.

**Step 2: Napsat failing matrix spec**

Stejný spec se spustí v Playwright projects `horizon` a `dawn` a ověří:

1. embed a static asset se načtou bez 404/500;
2. nativní product form zůstane jediným add-to-cart formem;
3. marker `[data-won-quantity-ready]` vznikne;
4. plus/minus respektuje step;
5. ruční neplatná hodnota se bezpečně opraví nebo zablokuje podle feature contractu;
6. minimum a maximum jsou v UI i input attributes;
7. variant change znovu aplikuje správné pravidlo;
8. add-to-cart odešle výslednou quantity;
9. mobile `390×844` i desktop `1440×1000` projdou;
10. nejsou nové console errors, page exceptions ani failed requests.

**Step 3: Ověřit, že spec padá před seedem/implementací**

```bash
npm run test:e2e -w won-quantity
```

Expected: FAIL na chybějícím seed/config nebo markeru, ne falešný skip.

**Step 4: Implementovat setup/teardown**

Setup vytvoří pouze Won Quantity pravidla pro existující test products. Teardown odstraní pouze data s app-specific test namespace. Produkční data ani B2B catalogy se nesmí měnit.

**Step 5: Spustit oba themes sekvenčně**

Terminal A:

```bash
npm run dev -w won-quantity
```

Terminal B:

```bash
npm run test:e2e:local:all -w won-quantity -- --bail
```

Expected: Horizon PASS, Dawn PASS, 0 relevant console errors, 0 failed app assets/proxy requests.

**Step 6: Commit**

```bash
git add apps/won-quantity
git commit -m "test: cover quantity flow on Horizon and Dawn"
```

---

### Task 13: Přidat root orchestration a release gate

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create or modify: CI workflow used by the repository
- Create: `apps/won-quantity/README.md`

**Step 1: Zachovat explicitní app selection**

Root `npm run dev` může dál ukazovat na `b2b-companion`, ale README musí preferovat explicitní:

```bash
npm run dev -w won-quantity
npm run build -w won-quantity
npm run test:e2e:local:all -w won-quantity
```

Nepřidávat magii, která spouští dvě Shopify CLI app sessions v jednom terminálu.

**Step 2: Přidat portfolio-wide statické gate**

Root scripts:

```json
"typecheck:apps": "npm run typecheck --workspaces --if-present",
"build:apps": "npm run build --workspaces --if-present",
"test:packages": "npm test --workspaces --if-present"
```

Před přidáním ověřit, že extension workspaces bez daného scriptu jsou díky `--if-present` bezpečně přeskočeny.

**Step 3: Rozdělit CI podle determinismu**

Každý PR:

- package/domain tests;
- app unit + contract tests;
- typecheck;
- app build;
- Shopify config/extension validation bez merchant dat.

Release/manual gate:

- `shopify app dev` smoke;
- Horizon + Dawn local theme matrix;
- theme editor activation test;
- install/uninstall/reinstall test;
- žádné secrets v diffu.

**Step 4: Spustit celý statický gate**

```bash
npm run test:packages
npm run typecheck:apps
npm run build:apps
git diff --check
```

Expected: PASS.

**Step 5: Spustit finální storefront gate**

```bash
npm run test:e2e:local:all -w b2b-companion -- --bail
npm run test:e2e:local:all -w won-quantity -- --bail
```

Expected: obě appky projdou na vlastních Horizon/Dawn overlays bez vzájemné závislosti.

**Step 6: Commit**

```bash
git add package.json package-lock.json README.md apps/won-quantity
git commit -m "ci: add standalone app portfolio gates"
```

---

## Definition of done pro první standalone appku

- `won-quantity` má vlastní `client_id`, app proxy subpath, databázi a extension UID.
- `prisma generate` v `won-quantity` nemění Prisma client `b2b-companion`.
- App se nainstaluje na stejný dev store jako `b2b-companion`, ale nesdílí jeho session/config tabulky.
- Storefront feature se dodává theme app extension; merchant nemusí editovat Liquid theme soubory.
- `@won/core` vlastní quantity pravidla a testy.
- `@won/testing` vlastní pouze generickou Horizon/Dawn infrastrukturu.
- App-specific testy mají vlastní data namespace, proxy probe, DOM markery a cleanup.
- Stejný Playwright spec projde na Horizon i Dawn, mobile i desktop.
- Test kontroluje console errors, page exceptions, failed requests a app asset 404/500.
- Disable/uninstall nechá storefront v nativním funkčním stavu.
- Build, typecheck, unit, contract a E2E gate jsou popsány v README a spustitelné z rootu přes `-w won-quantity`.

## Doporučené pořadí práce

1. **Nejdřív Tasks 1–5:** opravit a zobecnit platformu. Odhad 1–2 pracovní dny.
2. **Potom Tasks 6–8:** vytvořit app skeleton a uzamknout scope. Odhad 0,5–1 den.
3. **Potom Tasks 9–10:** první funkční vertical slice. Odhad 2–4 dny podle admin UI.
4. **Nakonec Tasks 11–13:** izolované Horizon/Dawn E2E a release gate. Odhad 1–2 dny.

První instalovatelný pilot je realisticky práce přibližně na jeden soustředěný týden. App Store-ready produkt bude navíc potřebovat billing, produkční databázi, onboarding, GDPR/privacy webhooks, observability a App Store review gate.

