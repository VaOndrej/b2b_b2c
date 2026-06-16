# test.md — Co aplikace umí, co lze nakonfigurovat a co z toho jde testovat

> Přehled vygenerovaný průchodem celého repozitáře `b2b_b2c` (package `b2b-companion`).
> Slouží jako mapa funkcí → konfigurace → testovatelnost. Aktuální fáze: **MVP_5_0_2** (MVP_5_0_3 a MVP_5_1 rozpracované).

---

## 1. Co to za aplikaci je

**Shopify embedded admin app** (React Router 7 / Remix styl + Polaris + App Bridge), která dává neplus storům Plus-like B2B/B2C chování. NENÍ to theme. Jádro logiky je framework-agnostické v `core/`, vynucování (enforcement) běží přes **Shopify Functions**, které fungují na všech plánech, když je app distribuovaná jako public.

### 5 vrstev

| Vrstva | Cesta | Role |
|--------|-------|------|
| 1. Doménové jádro (IP) | `core/` | Čistá logika: segment, pricing, discount orchestrator, margin guard, quantity, visibility, storefront content. Bez Shopify/Remix/DB závislostí. 100% jednotkově testovatelné. |
| 2. Služby / orchestrace | `app/services/` | Most Prisma ↔ Shopify Admin GraphQL ↔ core. Hlavní: `margin-guard-config.server.ts` (~1300+ řádků). |
| 3. Admin UI + API + webhooky | `app/routes/` | Nastavení, app-proxy endpointy, webhooky. |
| 4. Extensions (enforcement + storefront) | `extensions/` | Discount Function + Cart Validation Function (JS) + Storefront Liquid app embed. |
| 5. Persistence | `prisma/` | SQLite v devu. Jediný řádek `MarginGuardConfig` (id="default") + dětské tabulky pravidel. |

> **Pozn. k duplicitě (záměrná):** discount/margin/cap logika existuje 2×: TS v `core/` (admin + preview) a ručně portovaný JS v `extensions/.../*_generate_run.js` (reálný checkout). Synchronizaci hlídají contract testy (`function-runtime-config-compat`, `shopify-function-config-contract`). Shopify Functions bundlují JS a nemohou importovat TS core.

---

## 2. Funkce → Konfigurace → Testovatelnost

Pro každou schopnost: **co umí**, **co se konfiguruje** (kde v adminu / které DB pole), **jak se vynucuje** a **co je pokryté/pokrytelné testy**.

### 2.1 Segment Engine (B2B vs B2C)
- **Umí:** Určit, zda je zákazník B2B nebo B2C. Priorita: nativní purchasing company (`hasPurchasingCompany` → B2B) → custom customer tag → fallback B2C.
- **Konfigurace:** `MarginGuardConfig.b2bTag` (default `"b2b"`, ale lze nastavit libovolný text v Global Settings). Case-insensitive porovnání tagů.
- **Enforcement/použití:** Vstupuje do všech ostatních modulů (pricing, discounts, visibility, quantity, content).
- **Kód:** `core/segment/segment.engine.ts`
- **Testy:** `tests/segment/segment-detection.test.ts`, `tests/contracts/b2b-tag-activation-contract.test.ts`
- **Testovatelné e2e:** B2B přes nativní company, B2B přes custom tag, anonymní B2C (viz manuální checklist v `MVP_5_0_2_TECHNICAL_DEBT.md`).

### 2.2 Pricing Engine (segmentové ceny + tier/volume pricing)
- **Umí:** Přepsat base cenu dle segmentu, aplikovat B2B price override (per product), tier pricing podle množství, spočítat effective base price před slevami.
- **Konfigurace:**
  - `ProductFloorRule.b2bOverridePrice` — B2B přímá cena na produkt.
  - `ProductTierPriceRule` — `minQuantity` + `unitPrice`, volitelně per segment (`segment = null` → platí pro oba).
- **Kód:** `core/pricing/pricing.engine.ts`, `pricing.pipeline.ts`, `pricing.config.ts`
- **Testy:** `tests/pricing/b2b-override-pricing.test.ts`, `tests/pricing/tier-pricing.test.ts`, `tests/pricing/pricing-config-resolution.test.ts`
- **Preview:** `app/services/pricing-preview.server.ts` (admin náhled výpočtu).

### 2.3 Discount Orchestrator (kombinace slev)
- **Umí:** Řešit kombinace slev — priority matrix, scope weighting (INPUT > PRODUCT > COUPON > COLLECTION > GLOBAL), stackability, blacklist kombinací, per-segment cap, globální max cap, lokální min-price cap na pravidlo.
- **Konfigurace:**
  - `DiscountRule` — `scope` (GLOBAL/PRODUCT/COLLECTION/COUPON), `percentOff`, `priority`, `stackMode` (STACKABLE/EXCLUSIVE/NEVER_WITH_COUPONS), `minPricePercentOfBasePrice`, `segment`.
  - `DiscountCombinationBlacklistRule` — zakázané páry (RULE_ID/COUPON_CODE/SCOPE) + segment.
  - `DiscountSegmentCap` — `maxCombinedPercentOff` per segment.
  - `MarginGuardConfig.allowStacking`, `MarginGuardConfig.maxCombinedPercentOff` (globální cap).
- **Enforcement:** Discount Function (`extensions/margin-guard-discount-function`).
- **Kód:** `core/discount/discount.orchestrator.ts`, `discount.rules.ts`, `discount.identity.ts`, `coupon-segment.rules.ts`
- **Testy:** `tests/discount/advanced-discount-orchestration.test.ts`, `advanced-orchestration.test.ts`, `discount-stacking.test.ts`, `discount-identity.test.ts`, `discount-function-enforcement.test.ts`, `tests/services/advanced-discount-orchestration.integrity.test.ts`

### 2.4 Coupon Segment Validation (kupóny per segment)
- **Umí:** Omezit kupón jen na B2B / B2C / ALL.
- **Konfigurace:** `CouponSegmentRule` — `code` + `allowedSegment`.
- **Enforcement:** Cart Validation Function (blokuje checkout při kupónu z cizího segmentu).
- **Testy:** `tests/discount/coupon-segment-validation.test.ts`, `tests/contracts/cart-runtime-coupon-enforcement-contract.test.ts`

### 2.5 Margin Protection (minimální cena / floor)
- **Umí:** Hlídat minimální cenu produktu (globální i per-product i per-segment), rozhodnout o ořezu slevy nebo blokaci checkoutu, logovat porušení.
- **Konfigurace:**
  - `MarginGuardConfig.globalMinPricePercent` (default 70), `b2bGlobalMinPricePercent` (default 70).
  - `ProductFloorRule.minPercentOfBasePrice` (+ volitelně per segment), `allowZeroFinalPrice` override.
  - `MarginGuardConfig.allowZeroFinalPrice`, `marginGuardEnabled` (master switch).
- **Enforcement:** Discount Function (ořez) + Cart Validation Function (blok), `MarginViolationLog` (audit).
- **Kód:** `core/margin/margin.guard.ts`, `floor.rules.ts`
- **Testy:** `tests/margin/global-floor-policy.test.ts`, `tests/margin/mvp1-readiness.test.ts`, `tests/services/violation-shared-margin-source-of-truth.test.ts`

### 2.6 Quantity Rules Engine (MOQ / step / max)
- **Umí:** MOQ per segment, step quantity (násobky — kartony), max quantity per produkt, max per kolekce, max per zákazník+produkt. Priorita rozlišení: produkt > kolekce > globální; segmentové pravidlo > nesegmentové.
- **Konfigurace:**
  - `ProductQuantityRule` — `minimumOrderQuantity`, `stepQuantity`, `maxOrderQuantity` (+ segment).
  - `CollectionQuantityRule` — `maxOrderQuantity` (+ segment).
  - `ProductCustomerQuantityRule` — `maxOrderQuantity` per `customerId`.
  - `MarginGuardConfig.allowRemoveAtMinimumOrderQuantity`.
- **Enforcement:** Cart Validation Function + storefront UI (selektor množství, notice + tlačítko „I understand").
- **Kód:** `core/quantity/quantity.engine.ts`, `quantity.rules.ts`
- **Testy:** `tests/quantity/quantity-engine.test.ts`, `tests/quantity/product-quantity-rule-upsert.test.ts`

### 2.7 Product / Variant Visibility (B2B-only / B2C-only / customer-only katalog)
- **Umí:** Řídit viditelnost produktů a variant podle segmentu (`ALL`, `B2B_ONLY`, `B2C_ONLY`, `CUSTOMER_ONLY`). Varianta A jako kusovka, varianta B jako karton.
- **Konfigurace:** `ProductVisibilityRule`, `ProductVariantVisibilityRule` (`visibilityMode` + volitelný `customerId`).
- **Enforcement:** Storefront app embed (skrytí karet/PDP) + Cart Validation Function (blok přidání do košíku) + app-proxy visibility payload.
- **Kód:** `core/visibility/visibility.engine.ts`, `app/services/storefront-visibility.server.ts`
- **Testy:** `tests/visibility/product-visibility.test.ts`, `storefront-visibility.server.test.ts`, `margin-guard-visibility.loader.test.ts`, `tests/routes/visibility-script.contract.test.ts`

### 2.8 Collection Visibility (B2B-only / B2C-only kolekce)
- **Umí:** Skrýt celé kolekce dle segmentu.
- **Konfigurace:** `CollectionVisibilityRule` (`visibilityMode` B2B_ONLY/B2C_ONLY, handle uložený v pravidle).
- **Enforcement:** **Jen** přes shop metafield `margin_guard.storefront_projection` (inline CSS `margin-guard-collection-default-hide`) — runtime app-proxy payload kolekce NENESE (důležité pro e2e seedování).
- **Testy:** `tests/services/storefront-projection.server.test.ts`, `tests/routes/visibility-script.contract.test.ts`

### 2.9 Segmented Storefront UX / Content (MVP_5)
- **Umí:** Segmentové obsahové sekce a podmíněné PDP bloky. Akce: `SWAP_IMAGE/TEXT/HTML/HREF`, `HIDE/SHOW`, `ADD_CLASS/REMOVE_CLASS`. Cílení: CSS selector nebo sémantická pozice (TOP_BANNER, ABOVE/BELOW_TITLE, ABOVE/BELOW_ADD_TO_CART, BOTTOM_BANNER). Per page type (HOME/PRODUCT/COLLECTION/CART/PAGE/ALL). Lokalizace přes `valueCsLocale`.
- **Konfigurace:** `StorefrontContentRule` (admin route `app.storefront-ux.tsx`).
- **Kód:** `core/storefront/storefront-content.engine.ts`, `storefront-content.types.ts`, `app/services/storefront-content.server.ts`
- **Testy:** `tests/storefront/storefront-content.test.ts`

### 2.10 Storefront Projection (anti-flash globální metafield, MVP_5_0_2)
- **Umí:** Předpočítat segmentově stabilní pravidla do shop metafieldu `margin_guard.storefront_projection`, aby je Liquid embed použil hned při renderu (řeší probliknutí). Obsahuje: B2B/B2C product & collection visibility, product quantity rules, variant visibility, B2B tag, bootstrap metadata. Customer-specific pravidla zůstávají runtime-only.
- **Pozn.:** Existují 2 paralelní metafieldy — legacy `margin_guard.hidden_handles` (produkty) + nový `storefront_projection` (kolekce + vše). Half-finished migrace.
- **Kód:** `app/services/storefront-projection.server.ts`, `margin-guard-visibility.loader.server.ts`, `extensions/margin-guard-storefront/blocks/margin_guard_visibility_embed.liquid`
- **Testy:** `tests/services/storefront-projection.server.test.ts`

### 2.11 Catalog Import (Shopify, příprava pro CSV/ERP)
- **Umí:** Auto-import produktů/kolekcí/variant ze Shopify do `CatalogProduct/Collection/Variant`. Picker s vyhledáváním místo ručního lepení `gid://`.
- **Konfigurace:** `MarginGuardConfig.productCatalogSourceType` (SHOPIFY), `productCatalogAutoImportEnabled`, sync stav (`productCatalogLastSyncAt/Error`).
- **Kód:** `app/services/product-catalog.server.ts`, `admin-catalog-search.server.ts`, `app/routes/app.api.catalog-search.tsx`, `app/components/admin-catalog-picker.tsx`
- **Testy:** `tests/services/admin-catalog-search.server.test.ts`, `tests/routes/catalog-search-route.test.ts`, `tests/routes/app-settings-catalog-picker.contract.test.ts`, `tests/components/admin-catalog-picker.helpers.test.ts`, `tests/e2e/auto-product-selection.test.ts`

### 2.12 Cart Validation aktivace + Discount Function aktivace
- **Umí:** Aktivovat/registrovat Shopify Functions, sledovat stav (`cartValidationStatus`, `cartValidationLastError/SyncAt`).
- **Kód:** `app/services/cart-validation-activation.server.ts`, `discount-function-activation.server.ts`, `cart-validation-violation-sync.server.ts`, `app/routes/app.api.activate-cart-validation.tsx`, `app.api.cart-validate.tsx`
- **Testy:** `tests/services/activation-cart-validation-activation.test.ts`, `discount-function-activation.test.ts`, `tests/routes/cart-validate-admin-endpoint.test.ts`, `tests/cart/*`, `tests/routes/violations-sync-mode.test.ts`

### 2.13 Webhooky
- **Umí:** Reagovat na `orders/create` (sync violation logu), `app/uninstalled`, `app/scopes_update`.
- **Kód:** `app/routes/webhooks.*.tsx`, `app/services/orders-create-webhook.server.ts`
- **Testy:** `tests/webhooks/orders-create.test.ts`

---

## 3. Konfigurovatelná pole — souhrn (DB)

`MarginGuardConfig` (globální, 1 řádek): `b2bTag`, `globalMinPricePercent`, `b2bGlobalMinPricePercent`, `allowZeroFinalPrice`, `allowRemoveAtMinimumOrderQuantity`, `allowStacking`, `maxCombinedPercentOff`, `marginGuardEnabled`, `productCatalogSourceType`, `productCatalogAutoImportEnabled`, `cartValidationStatus`.

Dětská pravidla (per produkt/kolekce/varianta/zákazník/kupón): `ProductFloorRule`, `ProductTierPriceRule`, `ProductQuantityRule`, `CollectionQuantityRule`, `ProductCustomerQuantityRule`, `ProductVisibilityRule`, `ProductVariantVisibilityRule`, `CollectionVisibilityRule`, `CouponSegmentRule`, `DiscountRule`, `DiscountCombinationBlacklistRule`, `DiscountSegmentCap`, `StorefrontContentRule`. Audit: `MarginViolationLog`.

### Admin navigace (kde se to konfiguruje)
- **Dashboard** (`app._index.tsx`)
- **Global Settings** (`?section=global`) — B2B tag, globální floor %, stacking, max cap, catalog auto-import.
- **Catalog Rules** (`?section=products|collections|quantity|visibility`) — floor, tier, MOQ, step, max, customer overrides, product/variant/collection visibility.
- **Discounts** (`?section=discount-coupons|discount-orchestration`) — kupóny per segment, priority/blacklist/cap.
- **Storefront UX** (`app.storefront-ux.tsx`) — obsahová pravidla.
- **App Health** (`app.health.tsx`) — stav funkcí/sync.

> Pozn.: `app.settings.tsx` (~3300 řádků) je JEDNA komponenta obsluhující 4 nav položky přes `?section=`. Sub-routy `app.settings.global/catalog-rules/discounts.tsx` jen re-exportují tentýž loader/action/default.

---

## 4. Testovací vrstvy — jak se to spouští

| Příkaz | Co dělá |
|--------|---------|
| `npm run guard:test:core` | ~203 node:test casů (TS strip-types) přes core/services/routes/contracts/integration. Rychlé, bez Shopify/storefrontu. |
| `npm run guard:test:e2e` | Playwright přes `scripts/run-playwright-e2e.mjs`, objeví `tests/e2e/*.spec.ts`. |
| `npm run guard:test` | Oba dohromady. Je to gate v `predev` i `predeploy`. |
| `npm run test:e2e:storefront` | Přímo Playwright storefront smoke/listing testy. |
| `npm run typecheck` | `react-router typegen && tsc --noEmit`. |

### Povinná test policy (`tests/TESTING_POLICY.md`)
Každá změna v pricingu/Shopify Function chování musí mít **všechny 3 vrstvy**, jinak je neúplná:
1. **Unit** — čistá pravidla (discount, margin, segment, floor).
2. **Contract** — tvar input query + generovaný config payload musí zůstat kompatibilní.
3. **Runtime integration** — builder output musí být konzumovatelný cílovou runtime funkcí.

---

## 5. Co konkrétně JDE testovat

### 5.1 Plně pokryté unit/kontrakt/integrace (deterministické, bez storefrontu)
Všechno z `core/` + orchestrace v `app/services/` + tvar API a config payloadů:
- Segment detection (company / tag / fallback).
- Pricing: B2B override, tier pricing, config resolution.
- Discount: stacking, priority, blacklist, segment caps, global cap, identity/canonical key, enforcement port.
- Margin: globální/produktový/segmentový floor, zero-final-price policy, sdílený zdroj pravdy pro violation.
- Quantity: MOQ, step, max (produkt/kolekce/zákazník), priorita pravidel.
- Visibility: produkt + varianta + collection projekce, loader payload.
- Storefront content: resolution akcí/pozic/locale.
- Catalog: search service, picker helpery, route, auto-selection.
- Cart validation + discount aktivace, violations sync mode.
- Webhook `orders/create`.
- Contract testy synchronizující TS core ↔ JS Functions (`function-runtime-config-compat`, `shopify-function-config-contract`, `shopify-config-contract`, `ops-config-hardening`, `repo-cleanup-function-stubs`).

### 5.2 E2E / storefront (Playwright, `tests/e2e/`)
Chrání reálný storefront — **skip není failure** (přeskočí bez živé app instance + naseedovaných scénářů):
- Načtení Margin Guard theme app embedu na reálné PDP.
- Visibility banner + blokace add-to-cart pro skrytý produkt.
- MOQ / step notice na PDP + normalizace `quantity` inputu.
- Variant visibility banner pro B2B-only variantu.
- Max order quantity notice + „I understand" tlačítko.
- `storefront.listing.spec.ts`: B2B-only produkt zmizí z `/collections/all` (ne prázdný slot v carouselu/gridu).
- `storefront.listing.spec.ts`: B2B-only kolekce se schová z `/collections` přes projektované inline CSS.

**Jak spustit e2e proti živému storu:** běžící `npm run dev` (App Proxy přes tunel) + `SHOPIFY_E2E_STOREFRONT_BASE_URL`; volitelný local theme dev (`shopify theme dev` na `127.0.0.1:9292` + `SHOPIFY_E2E_SHOP_DOMAIN`). Scénáře se vybírají z restriktivních Prisma pravidel nebo přes `SHOPIFY_E2E_PRODUCT_HANDLE_{VISIBILITY,STEP,MAX,VARIANT}` / `SHOPIFY_E2E_COLLECTION_HANDLE`. Detaily: `tests/e2e/README.md`.

### 5.3 Co je momentálně JEN manuální (viz `MVP_5_0_2_TECHNICAL_DEBT.md`)
- Ověření, že po uložení visibility/quantity/variant/collection pravidla vznikne/aktualizuje se `shop.metafields.margin_guard.storefront_projection`.
- B2B segmentace přes nativní `customer.b2b?` vs. custom tag vs. anonymní B2C.
- Velikost metafieldu při větším katalogu (limit/chunking).
- E2E proti živému dev shopu v CI (zatím se bez instance gracefully přeskakuje — chybí dedikovaný CI job).

### 5.4 Známé mezery / tech-debt v testovatelnosti
- `margin-guard.visibility-script.tsx` (~4700 ř.) je Remix loader vracející obří client-side JS string — **bez typů a bez jednotkových testů na tom JS** (mechanika krytá nepřímo contract testy `hideCardForHandle`/early-hide).
- Duplicitní log cart validation (plánováno řešit v MVP_5_5).
- Dočasné `console.log(">>> SETTINGS LOADER...")` a verbose debug payloady k odstranění/schování za debug flag.
- Dva paralelní storefront metafieldy (`hidden_handles` vs `storefront_projection`) — konsolidace nedokončená.

---

## 6. Rychlá orientační tabulka: funkce ↔ test soubor(y)

| Funkce | Hlavní test(y) |
|--------|----------------|
| Segment detection | `tests/segment/segment-detection.test.ts`, `contracts/b2b-tag-activation-contract` |
| B2B override / tier pricing | `tests/pricing/*` |
| Discount orchestration | `tests/discount/*`, `services/advanced-discount-orchestration.integrity` |
| Coupon segment | `tests/discount/coupon-segment-validation`, `contracts/cart-runtime-coupon-enforcement-contract` |
| Margin / floor | `tests/margin/*`, `services/violation-shared-margin-source-of-truth` |
| Quantity (MOQ/step/max) | `tests/quantity/*`, `cart/*` |
| Product/variant visibility | `tests/visibility/*`, `routes/visibility-script.contract` |
| Collection visibility / projection | `tests/services/storefront-projection.server` |
| Storefront content | `tests/storefront/storefront-content` |
| Catalog import / picker | `tests/services/admin-catalog-search.server`, `routes/catalog-search-route`, `components/admin-catalog-picker.helpers`, `e2e/auto-product-selection` |
| Cart validation / activation | `tests/services/activation-cart-validation-activation`, `cart/*`, `routes/cart-validate-admin-endpoint`, `routes/violations-sync-mode` |
| TS core ↔ JS Function sync | `tests/integration/function-runtime-config-compat`, `contracts/shopify-function-config-contract` |
| Webhook orders/create | `tests/webhooks/orders-create` |
| Storefront (reálný prohlížeč) | `tests/e2e/storefront.smoke.spec.ts`, `storefront.listing.spec.ts` |
