# WonMarginGuard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build WonMarginGuard — a Shopify discounts hub whose Discount Function applies direct %/fixed discounts to non-excluded cart lines and clamps its own discount so no line drops below a margin floor; with one-click safe migration of native Shopify discounts.

**Architecture:** Pure, framework-free logic lives in `@won/core` (`packages/core/src/margin/`, heavy reuse of existing `floor.rules`, `margin.guard`, `conflict.detector`, `discount.*`). A Rust Discount Function (`cart.lines.discounts.generate.run`) reads a config metafield mirrored from Prisma and emits `productDiscountsAdd` operations with an exact per-unit floor clamp. A React-Router/Polaris admin authors discounts/exclusions/floors and drives the migration subsystem via Admin GraphQL.

**Tech Stack:** npm workspaces monorepo; `@won/core` (TypeScript, tested with `tsx --test` / `node:test`); app cloned from `apps/_template` (React Router + Polaris + Prisma); Shopify Discount Function in Rust (`shopify app function build/run`); Admin GraphQL (2026-04+).

## Global Constraints

- Design spec (source of truth): `docs/superpowers/specs/2026-08-10-won-marginguard-design.md`. Roadmap card: `docs/product-roadmap.html` (Won MarginGuard). Memory: `won-cart-suite-souls-limits`.
- Discount Function API is **pure**: no network, no time, no random. All data via the input query + config metafield.
- Money amounts are **Decimal strings** (`"10.0"`), never JS numbers, in Function output.
- Function must emit `{operations:[]}` unless `discount.discountClasses` contains `PRODUCT`.
- Exclusion is **split by mechanism** (locked by validated contract): collection + tag via input-query args `inAnyCollection(ids:)` / `hasAnyTag(tags:)` (ids/tags passed as query variables with app-baked defaults, **never referenced in Rust**); variant id / product id / product type / gift-card matched **in the function body** against config metafield lists.
- Floor default basis = `sellingPrice`; `compareAt` basis is Pro. `compareAtAmountPerQuantity` is **nullable** → fall back to `amountPerQuantity`.
- Migration writes are **destructive to live discounts** → never migrate without a completed Backup; deactivate-native and create-app must be atomic per discount; codes must be deactivated/renamed before recreate (shop-wide uniqueness).
- Name is **WonMarginGuard**; discount message string = `"WonMarginGuard"`. App metafield namespace `$app:won-margin-guard`, key `config`.
- Free tier caps at **50 active discounts**. Pro gates scope, never protection quality.
- Reuse before adding. Follow `apps/_template` and existing `@won/core` patterns. DRY, YAGNI, TDD, frequent commits.

## Scope & how to read this plan

- **MVP0–MVP1** below are at full bite-sized TDD granularity — build-ready now.
- **MVP2–MVP5** are task-level outlines (deliverables + interfaces + test focus). Each MUST be expanded into its own detailed plan (`writing-plans`) when reached, because its steps depend on MVP1's realized code. Do not implement MVP2+ from outlines alone.

## File Structure

Core (`packages/core/src/margin/`):
- `exclusion.rules.ts` — **NEW**. `isExcluded()` for kinds variant|product|productType|giftCard (collection|tag are resolved in the Function query, but the same module exposes the config shape). One responsibility: decide if a line is excluded given config lists + query-resolved booleans.
- `floor.rules.ts` — **MODIFY**. Add `basis` to `ProductFloorRule` (+ a `FloorBasis` type).
- `discount-clamp.ts` — **NEW**. Pure per-unit clamp math (basis→floor→clamped discount → emit descriptor). Framework-free; the Function mirrors this logic in Rust and core owns the reference + tests.
- (reuse unchanged) `margin.guard.ts`, `conflict.detector.ts`, `discount.rules.ts`, `discount.orchestrator.ts`, `coupon-segment.rules.ts`.

Core tests (`packages/core/tests/margin/`): `exclusion.rules.test.ts`, `floor.rules.test.ts`, `discount-clamp.test.ts`.

App (`apps/won-marginguard/`, cloned from `_template`):
- `prisma/schema.prisma` — `MgDiscount`, `ExclusionRule`, `FloorRule`, `MigrationBackup`.
- `app/services/config.server.ts` — resolve Prisma → config JSON; mirror to app metafield.
- `app/services/discount-config.server.ts` — build the Function config metafield payload from `MgDiscount`+`ExclusionRule`+`FloorRule`.
- `app/routes/app.discounts.tsx`, `app.exclusions.tsx`, `app.floors.tsx` — admin authoring.
- `extensions/won-margin-guard/` — Rust Discount Function (`src/run.rs`, `src/run.graphql`, `src/main.rs`, `shopify.extension.toml`).
- (MVP2+) `app/services/migration/*` — backup/dry-run/migrate/rollback.

---

## MVP0 — Skeleton

### Task 0.1: Clone app from _template

**Files:**
- Create: `apps/won-marginguard/` (rsync from `apps/_template/`)

**Interfaces:**
- Produces: a buildable workspace `won-marginguard` with predev/dev/typecheck/test:unit scripts.

- [ ] **Step 1: Clone and rename**

Run:
```bash
rsync -a --exclude node_modules --exclude .env apps/_template/ apps/won-marginguard/
cd apps/won-marginguard && grep -rl "_template\|won-app-template" . | xargs sed -i '' 's/won-app-template/won-marginguard/g'
```
(Follow `apps/_template/README` for the exact rename checklist.)

- [ ] **Step 2: Install + link**

Run: `npm install && npm run config:link -w won-marginguard`
Expected: workspace resolves; `shopify.app.toml` created.

- [ ] **Step 3: Verify skeleton builds**

Run: `npm run typecheck -w won-marginguard`
Expected: PASS (empty app).

- [ ] **Step 4: Commit**

```bash
git add apps/won-marginguard
git commit -m "feat(marginguard): scaffold app from _template"
```

### Task 0.2: Prisma models

**Files:**
- Modify: `apps/won-marginguard/prisma/schema.prisma`

**Interfaces:**
- Produces: `MgDiscount`, `ExclusionRule`, `FloorRule`, `MigrationBackup` models + generated client.

- [ ] **Step 1: Add models**

```prisma
model MgDiscount {
  id           String   @id @default(cuid())
  shop         String
  kind         String   // "percentage" | "fixed"
  value        Float
  appliesTo    String   // "order" | "line"
  method       String   // "automatic" | "code"
  code         String?
  combinesWith Json     // { orderDiscounts, productDiscounts, shippingDiscounts }
  enabled      Boolean  @default(true)
  startsAt     DateTime?
  endsAt       DateTime?
  usageLimit   Int?
  @@index([shop, enabled])
}

model ExclusionRule {
  id      String  @id @default(cuid())
  shop    String
  kind    String  // collection|tag|productType|giftCard|product|variant
  value   String
  enabled Boolean @default(true)
  @@index([shop, enabled])
}

model FloorRule {
  id                 String  @id @default(cuid())
  shop               String
  scope              String  // "global" | "product" | "variant"
  targetId           String?
  segment            String? // "B2B" | "B2C" | null
  minPercentOfBase   Float
  basis              String  @default("sellingPrice") // "sellingPrice" | "compareAt"
  allowZeroFinalPrice Boolean @default(false)
  @@index([shop])
}

model MigrationBackup {
  id        String   @id @default(cuid())
  shop      String
  createdAt DateTime @default(now())
  payload   Json     // raw discountNodes snapshot
  status    String   // "captured" | "migrated" | "rolledBack"
  @@index([shop, status])
}
```

- [ ] **Step 2: Generate + migrate**

Run: `npm run prisma:generate -w won-marginguard && npx prisma migrate dev --name marginguard_init --schema apps/won-marginguard/prisma/schema.prisma`
Expected: migration created, client generated.

- [ ] **Step 3: Commit**

```bash
git add apps/won-marginguard/prisma
git commit -m "feat(marginguard): prisma models for discounts/exclusions/floors/backup"
```

### Task 0.3: Discount Function scaffold (no-op)

**Files:**
- Create: `apps/won-marginguard/extensions/won-margin-guard/` (via CLI)

**Interfaces:**
- Produces: a building Function extension exporting `cart_lines_discounts_generate_run` that returns `{operations:[]}`.

- [ ] **Step 1: Generate extension**

Run:
```bash
cd apps/won-marginguard
shopify app generate extension --template discount --flavor rust --name=won-margin-guard
```

- [ ] **Step 2: Make run target a guarded no-op**

`src/run.rs` returns `Ok(CartLinesDiscountsGenerateRunResult { operations: vec![] })` and early-returns unless `discount.discountClasses` contains `PRODUCT`.

- [ ] **Step 3: Build**

Run: `shopify app function build` (in the extension dir)
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add apps/won-marginguard/extensions
git commit -m "feat(marginguard): discount function scaffold (guarded no-op)"
```

### Task 0.4: Config proxy + metafield mirror plumbing

**Files:**
- Create: `apps/won-marginguard/app/services/config.server.ts`
- Create: `apps/won-marginguard/app/services/discount-config.server.ts`

**Interfaces:**
- Produces: `buildFunctionConfig(shop): Promise<FunctionConfig>` and `mirrorConfigToMetafield(admin, shop): Promise<void>` where `FunctionConfig` = `{ mode, value, floorBasisPct, floorBasis, excludedVariantIds, excludedProductIds, excludedProductTypes, excludeGiftCards, excludedCollectionIds, excludedTags, message }`.

- [ ] **Step 1: Write failing test for config assembly**

`apps/won-marginguard/tests/services/discount-config.server.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleFunctionConfig } from "../../app/services/discount-config.server";

test("assembleFunctionConfig maps rules into function payload", () => {
  const cfg = assembleFunctionConfig({
    discount: { kind: "fixed", value: 12, appliesTo: "line", method: "automatic" },
    exclusions: [
      { kind: "variant", value: "gid://shopify/ProductVariant/999" },
      { kind: "productType", value: "Clearance" },
      { kind: "giftCard", value: "true" },
      { kind: "collection", value: "gid://shopify/Collection/1" },
      { kind: "tag", value: "outlet" },
    ],
    floor: { minPercentOfBase: 80, basis: "sellingPrice" },
  });
  assert.equal(cfg.mode, "fixed");
  assert.equal(cfg.floorBasisPct, 80);
  assert.deepEqual(cfg.excludedVariantIds, ["gid://shopify/ProductVariant/999"]);
  assert.deepEqual(cfg.excludedProductTypes, ["Clearance"]);
  assert.equal(cfg.excludeGiftCards, true);
  assert.deepEqual(cfg.excludedCollectionIds, ["gid://shopify/Collection/1"]);
  assert.deepEqual(cfg.excludedTags, ["outlet"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -w won-marginguard`
Expected: FAIL (`assembleFunctionConfig` not defined).

- [ ] **Step 3: Implement `assembleFunctionConfig`**

Pure function grouping exclusion rules by `kind` into the `FunctionConfig` lists and mapping the discount kind→`mode`, floor→`floorBasisPct`/`floorBasis`. `collection`/`tag` go to `excludedCollectionIds`/`excludedTags` (used to bake query-variable defaults when writing the extension), the rest to body-matched lists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -w won-marginguard`
Expected: PASS.

- [ ] **Step 5: Add `mirrorConfigToMetafield`** (writes `$app:won-margin-guard/config` via `metafieldsSet`), wired but not yet called by a route.

- [ ] **Step 6: Commit**

```bash
git add apps/won-marginguard/app/services apps/won-marginguard/tests
git commit -m "feat(marginguard): function config assembly + metafield mirror"
```

---

## MVP1 — Authoring + protection (the soul, shippable)

### Task 1.1: Core — `FloorBasis` + `ProductFloorRule.basis`

**Files:**
- Modify: `packages/core/src/margin/floor.rules.ts`
- Test: `packages/core/tests/margin/floor.rules.test.ts`

**Interfaces:**
- Produces: `type FloorBasis = "sellingPrice" | "compareAt"`; `ProductFloorRule.basis?: FloorBasis` (default treated as `"sellingPrice"`).

- [ ] **Step 1: Write failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductFloorRule } from "../../src/margin/floor.rules";
import { resolveFloorBasis } from "../../src/margin/floor.rules";

test("resolveFloorBasis defaults to sellingPrice", () => {
  const rule: ProductFloorRule = { productId: "p1", minPercentOfBasePrice: 80 };
  assert.equal(resolveFloorBasis(rule), "sellingPrice");
});
test("resolveFloorBasis honors compareAt", () => {
  const rule: ProductFloorRule = { productId: "p1", minPercentOfBasePrice: 80, basis: "compareAt" };
  assert.equal(resolveFloorBasis(rule), "compareAt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @won/core`
Expected: FAIL (`basis` / `resolveFloorBasis` missing).

- [ ] **Step 3: Add `FloorBasis`, `basis?` field, and `resolveFloorBasis(rule)` returning `rule.basis ?? "sellingPrice"`.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @won/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/margin/floor.rules.ts packages/core/tests/margin/floor.rules.test.ts
git commit -m "feat(core): FloorBasis + ProductFloorRule.basis (default sellingPrice)"
```

### Task 1.2: Core — `exclusion.rules.ts`

**Files:**
- Create: `packages/core/src/margin/exclusion.rules.ts`
- Test: `packages/core/tests/margin/exclusion.rules.test.ts`
- Reference pattern: `packages/core/src/toasts/exclusions.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ExclusionConfig {
    excludedVariantIds: string[];
    excludedProductIds: string[];
    excludedProductTypes: string[];
    excludeGiftCards: boolean;
  }
  export interface ExclusionLineSignals {
    variantId: string;
    productId: string;
    productType: string;
    isGiftCard: boolean;
    inExcludedCollection: boolean; // resolved by Function query
    hasExcludedTag: boolean;       // resolved by Function query
  }
  export function isExcluded(line: ExclusionLineSignals, cfg: ExclusionConfig): boolean;
  ```

- [ ] **Step 1: Write failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isExcluded } from "../../src/margin/exclusion.rules";

const base = { variantId: "v1", productId: "p1", productType: "Shirt",
  isGiftCard: false, inExcludedCollection: false, hasExcludedTag: false };
const empty = { excludedVariantIds: [], excludedProductIds: [], excludedProductTypes: [], excludeGiftCards: false };

test("not excluded when nothing matches", () => {
  assert.equal(isExcluded(base, empty), false);
});
test("excluded by variant id", () => {
  assert.equal(isExcluded(base, { ...empty, excludedVariantIds: ["v1"] }), true);
});
test("excluded by product type", () => {
  assert.equal(isExcluded({ ...base, productType: "Clearance" }, { ...empty, excludedProductTypes: ["Clearance"] }), true);
});
test("excluded when gift card and excludeGiftCards", () => {
  assert.equal(isExcluded({ ...base, isGiftCard: true }, { ...empty, excludeGiftCards: true }), true);
});
test("excluded by query-resolved collection", () => {
  assert.equal(isExcluded({ ...base, inExcludedCollection: true }, empty), true);
});
test("excluded by query-resolved tag", () => {
  assert.equal(isExcluded({ ...base, hasExcludedTag: true }, empty), true);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -w @won/core` → FAIL.

- [ ] **Step 3: Implement `isExcluded`** — returns true if ANY signal true: variant/product/type in cfg lists, `isGiftCard && excludeGiftCards`, `inExcludedCollection`, `hasExcludedTag`.

- [ ] **Step 4: Run to verify pass** — `npm test -w @won/core` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/margin/exclusion.rules.ts packages/core/tests/margin/exclusion.rules.test.ts
git commit -m "feat(core): exclusion.rules isExcluded (variant/product/type/giftCard/collection/tag)"
```

### Task 1.3: Core — `discount-clamp.ts` (reference clamp math)

**Files:**
- Create: `packages/core/src/margin/discount-clamp.ts`
- Test: `packages/core/tests/margin/discount-clamp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClampInput {
    mode: "percentage" | "fixed";
    value: number;             // pct (0-100) or fixed money units
    unitPrice: number;         // amountPerQuantity
    compareAtUnitPrice: number | null;
    floorBasis: "sellingPrice" | "compareAt";
    floorBasisPct: number;     // e.g. 80 => never below 80% of basis
  }
  export type ClampResult =
    | { emit: false }
    | { emit: true; mode: "percentage"; value: number }
    | { emit: true; mode: "fixed"; perUnitAmount: number };
  export function clampDiscount(input: ClampInput): ClampResult;
  ```

- [ ] **Step 1: Write failing tests (mirrors the validated contract math)**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampDiscount } from "../../src/margin/discount-clamp";

// L1: price 50, fixed 12 -> 38, floor .8*50=40 -> breach -> clamp to 10
test("fixed breaching floor clamps to exact per-unit", () => {
  assert.deepEqual(
    clampDiscount({ mode: "fixed", value: 12, unitPrice: 50, compareAtUnitPrice: null, floorBasis: "sellingPrice", floorBasisPct: 80 }),
    { emit: true, mode: "fixed", perUnitAmount: 10 });
});
// L2: price 100, fixed 12 -> 88, floor 80 -> ok -> keep fixed 12
test("fixed within floor kept as-is", () => {
  assert.deepEqual(
    clampDiscount({ mode: "fixed", value: 12, unitPrice: 100, compareAtUnitPrice: null, floorBasis: "sellingPrice", floorBasisPct: 80 }),
    { emit: true, mode: "fixed", perUnitAmount: 12 });
});
// percentage that does not breach stays percentage
test("percentage within floor kept as percentage", () => {
  assert.deepEqual(
    clampDiscount({ mode: "percentage", value: 15, unitPrice: 100, compareAtUnitPrice: null, floorBasis: "sellingPrice", floorBasisPct: 80 }),
    { emit: true, mode: "percentage", value: 15 });
});
// percentage that breaches converts to exact fixed per-unit
test("percentage breaching floor converts to fixed clamp", () => {
  // price 100, 30% -> 30 disc -> 70, floor 80 -> breach -> fixed 20
  assert.deepEqual(
    clampDiscount({ mode: "percentage", value: 30, unitPrice: 100, compareAtUnitPrice: null, floorBasis: "sellingPrice", floorBasisPct: 80 }),
    { emit: true, mode: "fixed", perUnitAmount: 20 });
});
// floor >= price -> no candidate
test("no emit when floor at or above price", () => {
  assert.deepEqual(
    clampDiscount({ mode: "fixed", value: 5, unitPrice: 40, compareAtUnitPrice: null, floorBasis: "sellingPrice", floorBasisPct: 100 }),
    { emit: false });
});
// compareAt basis with null falls back to selling price
test("compareAt basis falls back to unitPrice when compareAt null", () => {
  assert.deepEqual(
    clampDiscount({ mode: "fixed", value: 12, unitPrice: 50, compareAtUnitPrice: null, floorBasis: "compareAt", floorBasisPct: 80 }),
    { emit: true, mode: "fixed", perUnitAmount: 10 });
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -w @won/core` → FAIL.

- [ ] **Step 3: Implement `clampDiscount`** per Global Constraints math: `basis = floorBasis==="compareAt" ? (compareAtUnitPrice ?? unitPrice) : unitPrice`; `floor = basis*floorBasisPct/100`; `intended = mode==="fixed" ? value : unitPrice*value/100`; `maxAllowed = unitPrice - floor`; `clamped = min(intended, maxAllowed)`; if `clamped <= 0` → `{emit:false}`; if `clamped === intended && mode==="percentage"` → `{emit:true, mode:"percentage", value}`; else `{emit:true, mode:"fixed", perUnitAmount: round2(clamped)}`.

- [ ] **Step 4: Run to verify pass** — `npm test -w @won/core` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/margin/discount-clamp.ts packages/core/tests/margin/discount-clamp.test.ts
git commit -m "feat(core): discount-clamp reference math (floor clamp + pct->fixed conversion)"
```

### Task 1.4: Function `run.graphql` (validated input query)

**Files:**
- Create: `apps/won-marginguard/extensions/won-margin-guard/src/run.graphql`

**Interfaces:**
- Produces: the validated Input query (below), consumed by the Rust run target.

- [ ] **Step 1: Write the validated query** (PASS via `validate_graphql_codeblocks`, api `functions_discount`, schema 2026-04):

```graphql
query Input(
  $excludedCollectionIds: [ID!]
  $excludedTags: [String!]
) {
  discount {
    discountClasses
    metafield(namespace: "$app:won-margin-guard", key: "config") { jsonValue }
  }
  enteredDiscountCodes { code }
  cart {
    lines {
      id
      quantity
      cost {
        amountPerQuantity { amount currencyCode }
        compareAtAmountPerQuantity { amount }
      }
      merchandise {
        __typename
        ... on ProductVariant {
          id
          product {
            id
            productType
            isGiftCard
            inExcludedCollection: inAnyCollection(ids: $excludedCollectionIds)
            hasExcludedTag: hasAnyTag(tags: $excludedTags)
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate** (optional, if MCP available): `validate_graphql_codeblocks` (api functions_discount) → PASS.

- [ ] **Step 3: Bake query-variable defaults** — when the app writes/updates the extension config, `$excludedCollectionIds`/`$excludedTags` defaults come from `assembleFunctionConfig` output (collection/tag exclusions). Document in `shopify.extension.toml` input.

- [ ] **Step 4: Commit**

```bash
git add apps/won-marginguard/extensions/won-margin-guard/src/run.graphql
git commit -m "feat(marginguard): validated discount function input query"
```

### Task 1.5: Function `run.rs` (exclusion + clamp → productDiscountsAdd)

**Files:**
- Modify: `apps/won-marginguard/extensions/won-margin-guard/src/run.rs`
- Test: co-located Rust `#[cfg(test)]` with `run_function_with_input`

**Interfaces:**
- Consumes: config metafield JSON (`FunctionConfig`), input query fields.
- Produces: `CartLinesDiscountsGenerateRunResult` with `productDiscountsAdd` (per-`cartLine` targets, `selectionStrategy: ALL`, message `"WonMarginGuard"`).

- [ ] **Step 1: Write failing Rust test** (input.json: L1 price 50 breaching, L2 price 100 ok, L3 gift card excluded → expect fixed 10 on L1, fixed 12 on L2, no L3).

- [ ] **Step 2: Run to verify fail** — `shopify app function run --input=test/breach.json --export=cart_lines_discounts_generate_run` → mismatch.

- [ ] **Step 3: Implement run target:**
  - Early-return `{operations:[]}` unless `discountClasses` contains `PRODUCT` or metafield absent.
  - Deserialize `FunctionConfig` from `discount.metafield.jsonValue`.
  - For each line: build `ExclusionLineSignals` (variant/product/type/giftCard from merchandise; `inExcludedCollection`/`hasExcludedTag` from query aliases); skip if excluded (mirror `isExcluded`).
  - Compute clamp (mirror `clampDiscount`); `emit:false` → skip; else push a candidate targeting `{ cartLine: { id, quantity } }` with `fixedAmount{amount, appliesToEachItem:true}` or `percentage{value}` (Decimal strings).
  - Return `productDiscountsAdd{ selectionStrategy: ALL, candidates }`.

- [ ] **Step 4: Run to verify pass** — function run matches expected output.

- [ ] **Step 5: Build** — `shopify app function build` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/won-marginguard/extensions/won-margin-guard/src
git commit -m "feat(marginguard): discount function applies exclusions + floor clamp"
```

### Task 1.6: Admin — author one automatic discount + exclusions + floor

**Files:**
- Create: `apps/won-marginguard/app/routes/app.discounts.tsx`, `app.exclusions.tsx`, `app.floors.tsx`
- Modify: `app/services/config.server.ts` (call `mirrorConfigToMetafield` on save; create the automatic app discount via `discountAutomaticAppCreate` on first enable)

**Interfaces:**
- Consumes: `assembleFunctionConfig`, `mirrorConfigToMetafield`.
- Produces: persisted `MgDiscount`/`ExclusionRule`/`FloorRule` rows + a live automatic Function discount + mirrored metafield.

- [ ] **Step 1:** Discounts route — form to create ONE `MgDiscount` (kind %/fixed, value, appliesTo line/order, method=automatic). On save: upsert row, `assembleFunctionConfig`, `mirrorConfigToMetafield`, and if none exists `discountAutomaticAppCreate(functionId, combinesWith, metafields:[config])`.
- [ ] **Step 2:** Exclusions route — CRUD `ExclusionRule` (picker: collection/tag/productType/gift-card toggle/product/variant); "coverage" preview (count of products a rule matches via Admin query).
- [ ] **Step 3:** Floors route — global `minPercentOfBase` + per-product rows; `basis` toggle hidden behind Pro flag (default sellingPrice).
- [ ] **Step 4:** Wire enforcement of the **50 active discounts** Free cap on the discounts route (block create + upsell when count ≥ 50 on Free).
- [ ] **Step 5:** Manual verification via `shopify app dev` on a dev store — create discount + exclude `simpleB` + floor 80% → cart `simpleA`+`simpleB` shows discount only on `simpleA`, clamped where floor bites.
- [ ] **Step 6: Commit** — `feat(marginguard): admin authoring for discount + exclusions + floor`.

### Task 1.7: Integration test (E2E-adjacent)

**Files:**
- Create: `apps/won-marginguard/tests/integration/discount-allocation.test.ts`

- [ ] **Step 1:** Test via `discountAutomaticAppCreate` on a test shop + cart with `simpleA`+`simpleB`: assert `/cart.js` discount allocations apply only to `simpleA`, and a floor-bounded product shows the clamped amount. (Reuse `@won/testing` catalog + Horizon/Dawn harness.)
- [ ] **Step 2:** Gate — `test:unit`, `typecheck`, `build -w won-marginguard` (incl. Function), `validate:shopify` all green.
- [ ] **Step 3: Commit** — `test(marginguard): discount allocation integration (simpleA only)`.

---

## MVP2 — Code discounts + stacking (outline — expand before building)

- **Task 2.1** Function: read `enteredDiscountCodes { code }`; in the run body only emit when a buyer-entered code matches the config's `code` (case-normalized); set `candidate.associatedDiscountCode = { code }`. Add the `cart.lines.discounts.generate.fetch` target ONLY if network code validation/lookup is needed (functions are pure). *Test focus:* code match/no-match; attribution to code.
- **Task 2.2** Admin: `MgDiscount.method = "code"` authoring (code string, usage limit, appliesOncePerCustomer) → `discountCodeAppCreate`.
- **Task 2.3** Stacking control UI → `combinesWith` (order/product/shipping) with tag-scoping; carry the discount class. *Test focus:* combinesWith persisted + reflected in created discount.
- **Interfaces produced:** code-aware config field; `discountCodeAppCreate` service.

## MVP3 — Migration subsystem (outline — expand before building; safety-critical)

Deliverables: `Backup → Dry-run → Migrate → Report + Rollback` under `app/services/migration/`.

- **Task 3.1 Backup** — `discountNodes(first, after, query)` paginate full native inventory; `discountNode(id)` with inline fragments (`DiscountAutomaticBasic`/`DiscountCodeBasic`/`Bxgy`/`FreeShipping`/`App`) capturing value, targets, `combinesWith`, `customerSelection`, `minimumRequirement`, `usageLimit`, `startsAt/endsAt`, status, codes → persist full `MigrationBackup(status:"captured")`. A partial read MUST abort. *Requires `read_discounts` scope.*
- **Task 3.2 Dry-run classifier** — per native discount, classify **migratable** (amount-off-products/order, automatic+code, single-threshold basic) vs **non-migratable** with reason: BOGO (buy/get structure), free-shipping (shipping target), tiered/graduated (multi-break), app/function discounts (opaque config, 25-cap waste), condition-carrying basics (segment/subscription/multi-requirement → would broaden eligibility). Emit a report; NO writes.
- **Task 3.3 Safety gates in dry-run** (each a test): code shop-wide uniqueness via `codeDiscountNodeByCode(code)`; usage-count > 0 → refuse silent migrate; status classify (ACTIVE/SCHEDULED/EXPIRED); non-`all` `customerSelection` → quarantine; **25 active-function cap** count check; multi-currency fixed-amount warn (percentage is currency-safe); single-requirement-only carry (flag dropped second condition); idempotency key by native id.
- **Task 3.4 Migrate (atomic per discount)** — deactivate native (`discountAutomaticDeactivate`/`discountCodeDeactivate`) THEN create app discount (`discountAutomaticAppCreate`/`discountCodeAppCreate`) and verify status transition; codes: deactivate/rename native before recreate. Mark backup `status:"migrated"`; re-entrant (skip already-migrated ids).
- **Task 3.5 Report + Rollback** — final report (migrated / skipped+reason / manual-needed). Rollback from backup: `discountAutomaticActivate`/`discountCodeActivate` the originals + delete created app discounts; mark `status:"rolledBack"`.
- *Test focus:* fixture of native discounts through dry-run → expected classification; rollback restores exact pre-state.

## MVP4 — Shared authority (outline — expand before building)

- **Task 4.1** Extract the exclusion/floor config into a shared `@won/core` shape consumed by Tiers/Rewards/Outlet Functions (each self-excludes; no cross-Function veto).
- **Task 4.2** Outlet writes exclusion tags that MarginGuard's ruleset reads (tag kind already supported).
- *Test focus:* a sibling app's Function, given the shared ruleset, excludes the same lines.

## MVP5 — Pro (outline — expand before building)

- **Task 5.1** Cost-based floor: read `inventoryItem.unitCost` via Admin API, mirror per-variant cost floor into config metafield; clamp against cost+margin. (COGS is NOT in the Function input.)
- **Task 5.2** Segment/B2B floors: reuse `margin.guard`/`coupon-segment.rules` (`b2bMinPercentOfBasePrice`).
- **Task 5.3** Insights: "discount capped by floor on product X", most-excluded products (reuse `conflict.detector` output).
- **Task 5.4** Scheduling (config/metafield toggle, not in-Function), advanced stacking, `basis:"compareAt"` per-product toggle UI, custom badge app block, Shopify Billing + Pro gate.

---

## Self-Review notes

- **Spec coverage:** every spec §3–§11 element maps to a task (exclusion §3→1.2; floor §5→1.1/1.3/1.5; guarantee/stacking §6→2.3; migration §7→MVP3; Free/Pro §8→1.6 cap + MVP5; testing §10→1.7/per-task; ladder §11→MVP0–5).
- **Types consistent:** `FunctionConfig`, `ExclusionConfig`/`ExclusionLineSignals`, `ClampInput`/`ClampResult` names are reused verbatim across core, function, and services tasks.
- **Placeholders:** MVP0–1 carry real code/tests; MVP2–5 are explicitly outlines to be expanded via `writing-plans` before building (not placeholders inside buildable tasks).
- **Open items (morning):** app price at hub scope; free-shipping-code in/out; exact Stacking UI — carried from spec §12.
