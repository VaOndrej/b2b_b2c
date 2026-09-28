# Won Discounts MVP 0 — Scaffold + prototypy rizik (implementační plán)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Steps use checkbox (`- [ ]`) syntax. Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md)
> §1–§3, §10–§11. Stav běhu: [`../won-discounts-build-log.md`](../won-discounts-build-log.md).

**Goal:** Kostra appky `won-discounts` (config v0, prázdná discount funkce, theme app extension
s embedem, app proxy health, dev harness, živé E2E embedu na Horizon + Dawn) a verdikty rizik
C1–C5 s důkazem z dev storu.

**Architecture:** Config žije v Prisma (`ShopConfig` JSON + `schemaVersion`), čistá logika
v `packages/core/src/discounts/`. Discount funkce je JS (bundluje core), čte config z metafieldu
uzlu. Storefront = theme app extension s app embedem. Operace na dev storu jménem appky jdou
přes `shopify app execute` (bez admin tokenu).

**Tech Stack:** React Router 7 + `@shopify/shopify-app-react-router`, Prisma 6 (SQLite dev),
Polaris web components, Shopify Functions (JS, API 2026-04), theme app extension, `tsx --test`,
Playwright přes `@won/testing`.

## Global Constraints

- Dev store jen `b2b-b2c-store-development.myshopify.com`. Nikdy `shopify app deploy`.
- Sahat jen na `apps/won-discounts/**`, `packages/**` (core mění vždy jen jeden subagent),
  `docs/**`, `tests/**`, root `package.json` (skript `validate:shopify`). `apps/b2b-companion`
  a `apps/won-toasts` jen číst.
- Nečíst, nevypisovat, necommitovat `shpat.md`, `.env*`, `.auth/`, `prisma/dev.sqlite`.
- Cituj doktrínu v komentářích (`doctrine DATA-2`, `SF-1`…). Komentáře anglicky jako v repu,
  dokumenty česky.
- Každý úkol: testy červené první (spec, ne implementace), pak implementace, pak zelené.
- DB: SQLite (template) pro dev i testy [spec]; produkční DB se rozhodne v MVP 7.

---

## Mapa souborů

| Soubor | Odpovědnost |
|---|---|
| `packages/core/src/discounts/money.ts` | `MoneyByCurrency`, `moneyFor(currency)`, převody na minor units |
| `packages/core/src/discounts/config.ts` | typy configu v0, `DEFAULT_CONFIG`, `SCHEMA_VERSION`, `sanitizeConfig`, `migrateConfig`, `readStoredConfig` |
| `packages/core/src/discounts/function-config.ts` | `encodeFunctionConfig`, `FUNCTION_CONFIG_BUDGET_BYTES = 9000`, `byteLength` |
| `packages/core/tests/discounts/*.test.ts` | unit testy výše |
| `apps/won-discounts/prisma/schema.prisma` + migrace | `ShopConfig`, `ConfigVersion` |
| `apps/won-discounts/app/lib/config.server.ts` | `loadConfig(shop)`, `saveConfig(shop, input)` (sanitize + verze) |
| `apps/won-discounts/app/routes/app._index.tsx` | Přehled v0 (stav configu, stav embedu) |
| `apps/won-discounts/app/routes/won-discounts.health.tsx` | app proxy health, marker `won-discounts-health-ok` |
| `apps/won-discounts/app/routes/dev.preview.$.tsx` | dev-only harness, v produkci 404 |
| `apps/won-discounts/extensions/won-discounts-engine/` | JS discount funkce (2 targety), fixture testy |
| `apps/won-discounts/extensions/won-discounts-storefront/` | theme app extension: app embed + locales |
| `apps/won-discounts/e2e/settings_data.{horizon,dawn}.json` | overlay s aktivním embedem (generovaný skriptem) |
| `apps/won-discounts/scripts/make-e2e-overlay.mjs` | generuje overlay z kanonického tématu + uid extensionu |
| `apps/won-discounts/scripts/prototypes/*.mjs` | prototypy C1–C5 (dry-run default, `--live`) |
| `apps/won-discounts/tests/contracts/*.test.ts` | kontrakty: funkce, extension, harness, proxy |
| `apps/won-discounts/tests/e2e/storefront.embed.spec.ts` | živé E2E embedu |

---

### Task 1: Core — config v0 + money + rozpočet funkce (subagent A, jediný na `packages/core`)

**Files:** Create `packages/core/src/discounts/{money,config,function-config}.ts`,
`packages/core/tests/discounts/{money,config,function-config}.test.ts`.

**Interfaces — Produces:**
```ts
// money.ts
export type CurrencyCode = string;                       // ISO 4217, upper-case
export type MoneyByCurrency = Readonly<Record<CurrencyCode, number>>; // minor units, int ≥ 0
export function sanitizeMoneyByCurrency(v: unknown, opts?: {max?: number}): MoneyByCurrency;
export function moneyFor(m: MoneyByCurrency | undefined, currency: CurrencyCode): number | null; // null = trh bez hodnoty
// config.ts
export const SCHEMA_VERSION = 1;
export const COMBINATION_CATEGORIES = ["outletWithAnything","productWithProduct","productWithOrder","productWithShipping","orderWithShipping"] as const;
export interface WonDiscountsConfig { schemaVersion: 1; markets: MarketSetting[]; engine: EngineSettings;
  modules: { codes: {rules: DiscountRule[]}; tiers: {sets: TierSet[]}; rewards: RewardsModule;
             outlet: OutletModule; margin: MarginModule };
  campaigns: Campaign[]; storefront: StorefrontSettings; locales: LocaleDictionary; onboarding: OnboardingState; }
export const DEFAULT_CONFIG: WonDiscountsConfig;
export function sanitizeConfig(input: unknown): { config: WonDiscountsConfig; issues: ConfigIssue[] };
export function migrateConfig(stored: unknown): unknown;   // vN → current; v0/no-version fixture musí projít
export function readStoredConfig(stored: unknown): WonDiscountsConfig; // migrate + sanitize, nikdy nehodí
// function-config.ts
export const FUNCTION_CONFIG_BUDGET_BYTES = 9000;
export function encodeFunctionConfig(c: WonDiscountsConfig): { json: string; bytes: number; fits: boolean };
```
Typy a výchozí hodnoty přesně podle spec §2 (A1 kombinace výchozí, `countOtherDiscounts:false`,
`outlet.display:"strike_badge"`, `reopenOnReturnAfterEnd:"ask"`, `margin.global.maxDiscountPercent`
výchozí 50 [spec], trhy prázdné — naplní je admin z `markets` dotazu).

- [ ] **Step 1: Failing testy** (`node:test` + `node:assert/strict`, vzor `packages/core/tests/toasts/*`):
  - money: `sanitizeMoneyByCurrency({czk: 100000, EUR: -5, XX: 3, USD: "12.5", GBP: 9.9})` →
    `{CZK: 100000, GBP: 9}`. Pravidla: klíč → upper-case, jen `/^[A-Z]{3}$/`, hodnota musí být
    konečné `number` ≥ 0 (řetězce, záporné, NaN zahodit), float zaokrouhlit dolů, `max` clamp. `moneyFor(undefined,"CZK") === null`, `moneyFor({CZK:0},"CZK") === 0`.
  - config: `sanitizeConfig(null).config` deep-equals `DEFAULT_CONFIG`; neznámé klíče zahozené;
    `engine.combination.outletWithAnything` s řetězcem `"yes"` → výchozí `false` + issue;
    procento 150 → 100 + issue; `readStoredConfig({})` i `readStoredConfig("garbage")` vrátí platný
    config; fixture „v0 bez schemaVersion“ projde migrací; `sanitizeConfig(sanitizeConfig(x).config)`
    je idempotentní (property test na 20 náhodných vstupech s pevným seedem).
  - function-config: `encodeFunctionConfig(DEFAULT_CONFIG).fits === true`; config s 400 pravidly
    → `fits === false`, `bytes > 9000`; `bytes` počítá UTF-8 bajty (řetězec „Kč“ = 3 B).
- [ ] **Step 2:** `npm run test:packages` → FAIL (moduly neexistují).
- [ ] **Step 3:** Implementace (vzor sanitizace `apps/_template/app/lib/config-schema.ts`).
- [ ] **Step 4:** `npm run test:packages` → PASS; `npm run guard:test:core` → PASS (nic se nezměnilo).
- [ ] Výstup: co · důkaz (počty testů) · co neověřeno.

### Task 2: Persistence configu + Přehled v0 (subagent B, po Task 1)

**Files:** Modify `apps/won-discounts/prisma/schema.prisma`; Create migration
`prisma/migrations/20260928120000_config/migration.sql`, `app/lib/config.server.ts`,
`tests/lib/config.server.test.ts`, `tests/lib/test-db.ts`; Modify `app/routes/app._index.tsx`,
`app/routes/webhooks.app.uninstalled.tsx` + `webhooks.shop.redact.tsx` (smazání dat shopu, PRIV-2).

**Interfaces — Consumes:** Task 1 `readStoredConfig`, `sanitizeConfig`, `SCHEMA_VERSION`.
**Produces:**
```prisma
model ShopConfig    { shop String @id  schemaVersion Int  data String /* JSON */  updatedAt DateTime @updatedAt }
model ConfigVersion { id String @id @default(cuid())  shop String  schemaVersion Int  data String  createdAt DateTime @default(now())  @@index([shop, createdAt]) }
```
```ts
export async function loadConfig(db: PrismaClient, shop: string): Promise<WonDiscountsConfig>;
export async function saveConfig(db: PrismaClient, shop: string, input: unknown):
  Promise<{ config: WonDiscountsConfig; issues: ConfigIssue[]; versionId: string }>;
export async function deleteShopData(db: PrismaClient, shop: string): Promise<void>;
export const CONFIG_HISTORY_RETENTION_DAYS = 90;
```
- [ ] Failing testy (izolovaná SQLite DB per test soubor přes `prisma db push` do temp souboru —
  schéma odvozené ze `schema.prisma`, žádné ručně psané DDL; vzor principu `apps/won-toasts/tests/lib/test-db.ts`):
  nový shop → `DEFAULT_CONFIG`; `saveConfig` uloží sanitizovaný config + `ConfigVersion`;
  shop A neuvidí config shopu B (SEC-2); `deleteShopData` smaže obě tabulky jen pro daný shop;
  poškozený JSON v DB → `loadConfig` vrátí default, nehodí.
- [ ] Implementace + migrace (`prisma migrate diff` → SQL, commitnout). Přehled v0: Polaris
  `s-page` „Won Discounts“, sekce „Stav“: verze configu, počet pravidel (0), stav embedu
  (zatím „neověřeno“ — detekce přijde v MVP 1), žádné raw enumy (§4c).
- [ ] Brána: `npm run test:unit -w won-discounts`, `typecheck`, `lint`, `build`.

### Task 3: Discount funkce `won-discounts-engine` (subagent C = `shopify-functions-dev`)

**Files:** Create `apps/won-discounts/extensions/won-discounts-engine/**` přes
`shopify app generate extension --template discount --flavor vanilla-js --name won-discounts-engine --path apps/won-discounts`
(pak upravit), `tests/contracts/function.contract.test.ts`.

**Produces:**
- `shopify.extension.toml`: api_version `2026-04`, targety `cart.lines.discounts.generate.run`
  (`export = "cart-lines-discounts-generate-run"`) a `cart.delivery-options.discounts.generate.run`,
  `[extensions.input.variables] namespace = "$app:won_discounts" key = "function_config"`.
- Vstupní dotaz run targetu (ověřit přes Shopify MCP `validate` api `functions_discount`):
  `triggeringDiscountCode`, `enteredDiscountCodes { code rejectable }`,
  `discount { discountClasses metafield(namespace:"$app:won_discounts", key:"function_config") { jsonValue } }`,
  `shop { localTime { date } campaignActive: localTime { dateTimeBetween(startDateTime: $campaignStart, endDateTime: $campaignEnd) } }`
  (proměnné z metafieldu; alias podle toho, co schéma dovolí), `cart { cost { subtotalAmount { amount currencyCode } }
  lines { id quantity cost { amountPerQuantity { amount currencyCode } compareAtAmountPerQuantity { amount } }
  gift: attribute(key:"_won_gift") { value } merchandise { __typename ... on ProductVariant { id
  product { id wonProduct: metafield(namespace:"$app:won_discounts", key:"product") { jsonValue } } } } } }`,
  `localization { country { isoCode } }`.
- Logika MVP 0: **prototyp**, ne engine. `function_config.prototype` (objekt) řídí chování:
  `{ mode: "echo_codes" }` → pokud `triggeringDiscountCode`, vydá 1 % na první řádek se zprávou
  `WON:<triggering>|<sorted entered codes joined ,>`; `{ mode: "percent_all", percent }` → % na
  všechny řádky; `{ mode: "campaign_window" }` → sleva jen když `campaignActive`; `{ mode:
  "product_metafield" }` → % z `wonProduct.jsonValue.percent`. Chybějící/poškozený config →
  prázdné operace (nikdy výjimka — spec §9).
- [ ] Failing fixture testy (`tests/fixtures/*.json` + vitest z generátoru) pro každý mód +
  poškozený config; contract test v appce spustí `shopify app function run --input … --export …`
  nad fixture a porovná výstup (vzor `apps/b2b-companion/extensions/margin-guard-discount-function/tests`).
- [ ] `npm run build -w won-discounts` musí stavět i funkci (`shopify app function build` ve
  `build` skriptu nebo samostatný krok v bráně — rozhodni a zapiš).

### Task 4: Theme app extension + embed (subagent D)

**Files:** Create `apps/won-discounts/extensions/won-discounts-storefront/{shopify.extension.toml,
blocks/won_discounts_embed.liquid, assets/won-discounts.js, assets/won-discounts.css,
locales/en.default.json, locales/cs.json, locales/sk.json, .theme-check.yml}`,
`tests/contracts/theme-extension.contract.test.ts`; Modify root `package.json` `validate:shopify`
(přidat `&& shopify theme check --path apps/won-discounts/extensions/won-discounts-storefront`).

**Produces:** App embed (`"target": "body"`) renderuje
`<div id="won-discounts-root" data-won-discounts-embed data-won-discounts-status="ready"
data-won-discounts-currency="{{ cart.currency.iso_code }}" hidden></div>` + `<script type="application/json"
id="won-discounts-config">{{ app.metafields.won_discounts.storefront_config.value | json }}</script>`
(prázdný objekt, když metafield chybí) a načte JS s `defer`. JS jen nastaví `window.WonDiscounts =
{version, ready: true}` a idempotentní init guard (SF-1). Žádná mutace košíku.
- [ ] Failing contract test: embed obsahuje markery, JS nesahá na `/cart/add|change|update`,
  JS ≤ 10 kB gz (SF-2), locales klíče shodné ve všech 3 jazycích.
- [ ] `npm run validate:shopify` → 0 offenses pro won-discounts extension (Toasts část musí zůstat zelená).

### Task 5: App proxy health + dev harness (subagent E)

**Files:** Create `app/routes/won-discounts.health.tsx`, `app/routes/dev.preview.$.tsx`,
`app/lib/dev-harness.server.ts`, `tests/contracts/{app-proxy,dev-harness}.contract.test.ts`.

**Produces:** `GET /apps/won-discounts/health` (přes `authenticate.public.appProxy`) → JSON
`{status:"won-discounts-health-ok"}`, `Cache-Control: no-store`. Harness: `isDevHarnessEnabled()`
= `process.env.NODE_ENV !== "production" && process.env.WON_DEV_HARNESS !== "0"`; v produkci loader
hodí 404 **a** route se do produkčního bundlu nedostane (build-time guard: `app/routes.ts` přidá
harness routu jen mimo produkci — contract test sestaví `npm run build` a ověří, že
`build/server/index.js` neobsahuje řetězec `dev.preview`).
Harness v MVP 0 renderuje Přehled v0 s fixture configem (mock session, bez Shopify auth).

### Task 6: Živé E2E embedu (subagent F, po Task 3+4)

**Files:** Create `scripts/make-e2e-overlay.mjs`, `e2e/settings_data.horizon.json`,
`e2e/settings_data.dawn.json`, `tests/e2e/storefront.embed.spec.ts`, `playwright.config.ts` (upravit);
Modify `e2e.app.config.mjs` (`settingsDataOverlay` per téma).

**Produces:** Overlay = kanonický `config/settings_data.json` sdíleného tématu + v
`current.blocks` app embed `{ "type": "shopify://apps/won-discounts/blocks/won_discounts_embed/<registrační UUID extensionu>", "disabled": false, "settings": {} }`.
**Oprava během běhu:** není to `uid` ze `shopify.extension.toml`, ale UUID, které přidělí Shopify
(`01a0e790-ee4d-733c-ac8e-14c7baa03fff`, zjištěno ze `settings_data.json` po jednorázovém zapnutí embedu).
Spec E2E (obě témata): na `/products/won-e2e-simple-a` existuje `[data-won-discounts-embed]`
se `data-won-discounts-status="ready"`, `window.WonDiscounts.ready === true`, na 390 px žádný
horizontální overflow (`assertResponsiveSane`), žádná chyba konzole z našeho assetu.
- [ ] `npm run test:e2e:local:all -w won-discounts` (bez `--bail`) → `✓ Horizon` i `✓ Dawn`.
  Předpoklad: běží `shopify app dev` (Terminál A).

### Task 7: Prototypy C1–C5 (orchestrátor + subagent C, po Task 3)

Každý prototyp = skript `scripts/prototypes/cN-*.mjs`, výchozí dry-run (vypíše plánované mutace),
`--live` provede přes `shopify app execute` a **uklidí** po sobě (smaže vytvořené uzly /
metafieldy). Výsledek + důkaz → build log „Verdikty rizik“, spec §11 upravit podle verdiktu.

- **C1 + C2:** vytvoř `discountAutomaticAppCreate` (functionId z `shopify app info --json` /
  `appFunctions`) a `discountCodeAppCreate` s kódem `WONPROTO1` + `discountRedeemCodeBulkAdd`
  `WONPROTO2`; config `echo_codes`. Playwright: odemkni storefront, přidej `won-e2e-simple-a`,
  `/cart/update.js {discount:"WONPROTO1,WONPROTO2"}`, přečti `/cart.js` → `discount_codes[]`
  (`applicable`) a `cart_level_discount_applications` / `line_level_discount_allocations[].discount_application.title`
  s `WON:<triggering>|<entered>`. Verdikt C1 = entered obsahuje oba kódy; C2 = jeden uzel s 2 kódy,
  kolik jich je `applicable` současně.
- **C3:** metafield 9 000 B vs. 10 100 B na uzlu (`percent_all`) → v košíku sleva je / není;
  produktový metafield `won_discounts.product {percent: 7}` na `won-e2e-simple-a` + mód
  `product_metafield` → 7 % v košíku.
- **C4:** proměnné `campaignStart/End` v metafieldu (čas obchodu America/New_York): okno kolem teď →
  sleva je; okno za hodinu → není.
- **C5:** `curl -sI` storefront stránky → `content-security-policy` `frame-ancestors` /
  `x-frame-options`; když zakazuje cizí originy, verdikt = fallback (tokeny tématu + „Zobrazit na mém
  webu“). Když povoluje, Playwright ověří iframe z app originu.

### Task 8: Brána, QA, audit, commit (orchestrátor)

- [ ] Společná brána (spec §10) + E2E bez `--bail` + vizuální QA 390/1440 (harness Přehled v0 +
  storefront PDP s embedem) + `won-auditor` → P0–P1 opravit.
- [ ] Self-audit, roadmap (badge zůstává `Scaffold`, MVP 0 ✓ s verdikty), build log, commit
  „won-discounts MVP 0: scaffold + verdikty rizik C1–C5“, `git push origin main`.

---

## Self-review

- Spec §10 MVP 0 (scaffold, config v0, prázdná funkce, embed, prototypy C1–C5, verdikty, úprava
  specu) → Task 1–8 ✓. Dev harness (spec §5) → Task 5 ✓. E2E „pending“ se nepřijímá → Task 6 ✓.
- Názvy: `readStoredConfig`, `sanitizeConfig`, `encodeFunctionConfig`, `FUNCTION_CONFIG_BUDGET_BYTES`,
  metafield `$app:won_discounts` / `function_config` / `product` / `storefront_config` konzistentní.
