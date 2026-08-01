# MVP_5_3 — Simulované cenové katalogy: implementační zadání

> Planning artefakt. Implementaci spouštěj teprve až bude pokyn; tohle je zadání pro
> implementační AI. Drž se fází a guardrails.

## 0) Role a tvrdá pravidla
Jsi senior implementátor v repu `b2b_b2c` (Shopify embedded admin app, Remix/RR7 +
Polaris, `core/` čistá doména, `extensions/` Shopify Functions, Prisma/SQLite).
- Pracuj POSTUPNĚ po fázích níže. Fázi nezačínej, dokud předchozí nemá zelené testy
  (`npm run guard:test:core`) a `tsc --noEmit` = 0 chyb.
- Strategie = MOVE-NOT-COPY (sdílené moduly, žádná duplikace UI/handlerů) — jako
  dekompozice MVP_5_1.
- NEROZBÍJEJ value-based enforcement backstop ani TS↔JS contract testy.
- Po každé fázi napiš krátké shrnutí změněných souborů + stavu testů.

## 1) Potvrzená architektura (NEMĚNIT, je rozhodnuto)
- Katalog NAHRAZUJE binární segment jako primární abstrakci. Segment B2B/B2C zaniká
  jako rozhodovací dimenze — jediná otázka je „do kterého katalogu zákazník spadne".
- Plná SIMULACE: appka vlastní VŠECHNY katalogy, native catalog API ignoruje.
- Default (base) katalog = globální baseline (= dnešní „Global settings", fallback pro
  anonyma/B2C). Konkrétní katalogy DĚDÍ z defaultu a přepisují jen co nastaví.
- Katalog = univerzální scoping klíč: audience + membership + price list + floor +
  slevy + quantity. Editor katalogu = taby per faseta.
- B2B Pricing jako modul ZANIKÁ (rozpustí se do price-list tabu katalogu). Segmented
  Storefront UX obsah (sekce/PDP/messaging) ZŮSTÁVÁ samostatně.
- Config distribuce: DELTA-ENCODING (katalog ukládá jen rozdíly vs default).
- Price list: FULL NATIVE PARITY (katalog % + per-collection % + per-product/variant
  FIXED|% + tier). Precedence most-specific-wins (viz §4).
- Membership: default/systémové katalogy = inherit-all; nové katalogy = explicit opt-in.
- **Variant granularita (Q1): jeden produkt v adminu, pravidla na úrovni VARIANTY.**
  Merchant volí per produkt mezi dvěma vzory: (a) kartón-jako-varianta (vlastní cena/
  foto/viditelnost) NEBO (b) quantity-driven (step+tier na téže variantě). Oba vzory
  musí jít. Žádné dva typy produktů v adminu.
- **Měna/doména/jazyk (Q2): DELEGOVÁNO na Shopify Markets** (zdarma i non-Plus). Katalog
  je customer/segment osa + VOLITELNÝ market/locale filtr. Pricing preferuje %; FIXED
  ceny jen pro market-scoped katalog (viz §6).

## 2) Současný stav = DVA ZADRÁTOVANÉ KATALOGY (výchozí bod)
Appka už je dvou-katalogový systém, jen natvrdo:
- `prisma/schema.prisma`: `MarginGuardConfig` (singleton id="default") + child tabulky,
  každá s nullable `segment` (null="obojí" | "B2B" | "B2C").
- `core/config/function-config.ts` → `buildCartValidationFunctionConfig` /
  `buildDiscountFunctionConfig`: zplošťuje pravidla do DVOU paralelních map
  (`*B2C` + `*B2B`); null → do obou.
- Publikace do metafieldů:
   - funkce: `$app:margin_guard / config` (přes `app/services/cart-validation-activation.server.ts`
     + `discount-function-activation.server.ts`)
   - storefront: `margin_guard / storefront_projection` (+ legacy `margin_guard / hidden_handles`)
     přes `app/services/storefront-projection.server.ts`
- Runtime `extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js`
  (+ `…-discount-function/src/cart_lines_discounts_generate_run.js`):
   - segment: `isB2B = hasPurchasingCompany || hasB2BTag; segment = isB2B ? "B2B" : "B2C"`
   - všude `perXxx = isB2B ? config.xxxB2B : config.xxxB2C`
   - input query `…generate_run.graphql`: `customer.hasAnyTag($b2bTags)` +
     `hasTags($loyaltyTags){tag hasTag}` + `purchasingCompany.company.id` +
     `localization { language { isoCode } }`. Schéma navíc vystavuje
     `localization.country.isoCode` a `presentmentCurrencyRate` (využije §6).
- Orchestrace: `app/services/margin-guard-config.server.ts` (~1350 ř.).

## 3) Datový model (nové Prisma modely)
Pozor na kolizi: existující `CatalogProduct/Collection/Variant` je import master-list
(NE cenový katalog) — nech být, jen ho v UI přejmenuj na „Products / Source".

Přidej:
- `PriceCatalog` { id, name, priority Int, status, isDefault Bool, isSystem Bool,
  membershipMode ("INHERIT_ALL"|"OPT_IN"), createdAt, updatedAt }
- `CatalogAudienceTag` { catalogId, tag }  @@unique([catalogId, tag])
- `CatalogMarketFilter` { catalogId, countryCode?, currencyCode?, languageCode? } — Q2
- `CatalogMembership` { catalogId, productId }  @@unique([catalogId, productId])
- `CatalogPriceRule` { catalogId, scope("CATALOG"|"COLLECTION"|"PRODUCT"|"VARIANT"),
  targetId?, mode("FIXED"|"PERCENT"), value }
- `CatalogTierPriceRule` { catalogId, productId, variantId?, minQuantity, unitPrice } — Q1
- `CatalogFloorRule` { catalogId, productId?, variantId?, minPercentOfBasePrice,
  allowZeroFinalPrice? }  (productId null = katalogový default) — Q1
- `CatalogQuantityRule` { catalogId, productId?, variantId?, collectionId?, moq?, step?,
  max? } — Q1
- `CatalogDiscountRule` { catalogId, scope, targetId?, code?, percentOff, priority,
  stackMode, minPricePercentOfBasePrice? } — absorbuje MVP_5_2 `DiscountRule` (viz §5)

**Migrace (segment → catalogId FK), mapování:**
- `segment=null → default(B2C) katalog`; `segment="B2B" → B2B systémový katalog`;
  `segment="B2C" → default katalog`.
- `MarginGuardConfig` globální knoby (`globalMinPricePercent`, `b2bGlobalMinPricePercent`,
  `allowStacking`, `maxCombinedPercentOff`) → floor/policy default a B2B katalogu.
- `ProductFloorRule.b2bOverridePrice` → `CatalogPriceRule(scope=PRODUCT, mode=FIXED)` na
  B2B katalogu; `ProductTierPriceRule` → `CatalogTierPriceRule`.
- MVP_5_2: `DiscountRule.segment → catalogId`; `DiscountRule.requiredCustomerTag` →
  vytvoř/napoj LOYALTY katalog (audience tag = ten tag) a slevu zavěs jako
  `CatalogDiscountRule` na něj (viz §5). `CouponSegmentRule.allowedSegment` → povolené
  katalogy; `DiscountSegmentCap.segment` → per-katalog cap (default = baseline);
  `DiscountCombinationBlacklistRule.segment` → shop-policy na default katalogu + override.

## 4) Price list — precedence (FULL parity, most-specific-wins, NE-kompoundně)
Efektivní jednotková cena:
1. per-variant `FIXED` → ta cena
2. jinak per-product `FIXED` → ta cena
3. jinak `base × (nejspecifičtější PERCENT: variant% ?? product% ?? collection% ?? catalog%)`
4. jinak `base`
→ pak **tier** (množstevní): pokud match threshold, přepíše jednotkovou cenu z 1–4
→ pak **slevy** (orchestrator)
→ nakonec **floor** (value-based backstop, beze změny).
Promítni do `core/pricing/pricing.pipeline.ts` + `pricing.engine.ts` (rozšiř
`PricingInput` o catalog price-list vstupy). Per-collection % ve funkci využij
`merchandise.product.inCollections($collectionIds)`, který funkce už dostává.

## 5) Integrace reálného stavu MVP_5_2 (HOTOVÉ části MIGRUJ, neignoruj)
Ověřeno v kódu — z 5_2 je hotové a STABILNÍ:
- **Loyalty eligibilita** (`DiscountRule.requiredCustomerTag`, `loyaltyTags` v configu,
  `$loyaltyTags` + `hasTags` ve funkci, `discount.identity.ts` rozlišuje podle tagu).
- **Value-aware conflict detector** (`core/discount/conflict.detector.ts`: `PERCENTAGE` /
  `FIXED_AMOUNT` per-unit → % ekvivalent; per-order + BXGY → `UNVERIFIABLE_AGAINST_FLOOR`).
  Admin/cart report v `app/services/discount-conflict.server.ts`.

Dopady katalogů na 5_2:
- **Loyalty tier = KATALOG.** `$loyaltyTags` rail je prototyp catalog resolution →
  zobecni `$loyaltyTags`→`$catalogTags` (per-tag bool list, vyhraje nejvyšší priorita).
  Loyalty tier se stává katalogem s audience tagem; jeho sleva = `CatalogDiscountRule`.
  Žádný samostatný „loyalty" koncept — je to katalog.
- **`CatalogDiscountRule` absorbuje `DiscountRule`** (percent-only zůstává; fixed-amount
  ve vlastních slevách 5_2 NEMÁ a je mimo scope 5_3).
- **Conflict detector → per-katalog.** Zobecni `detectDiscountFloorConflicts` parametr
  `segments?: Segment[]` na katalogy: pro každý (produkt × katalog) čti floor a slevy
  rozřešeného katalogu vs native automatické slevy. Value-aware logiku zachovej beze
  změny (jen scope = katalog místo segmentu).
- Mimo scope 5_3 (5_2 kandidáti, nehotoví): fixed-amount ve vlastních slevách,
  scheduling, cart-value threshold. Neimplementuj je tady.

## 6) Markets / měna / doména / jazyk (Q2 — delegace)
- Doménu/jazyk/měnu NEPŘIŘAZUJEŠ katalogu přímo — patří Marketu; Shopify routuje
  doména→market→country/currency/language.
- `CatalogMarketFilter` = volitelná DRUHÁ resolution osa. Resolver matchne katalog jen
  když sedí i market filtr (country/currency/language). Funkce čte `localization.country
  .isoCode` + `language.isoCode` + presentment currency.
- Pricing: `%` adjustmenty jsou currency-safe (fungují ve všech měnách). `FIXED` ceny
  jsou currency-bound → povol je JEN na katalogu, který má `CatalogMarketFilter` s měnou;
  na měnově univerzálním (tag-only) katalogu FIXED cenu zakaž a v adminu varuj (jinak
  Markets double-konverze). 
- NE-cíl: nesimuluj konverzi měn ani rounding — to dělá Markets.

## 7) FÁZE 1 — Generalizace BEZE ZMĚNY CHOVÁNÍ (de-risk, povinné první)
Cíl: 2 zadrátované katalogy → N data-driven, navenek 0 změny. Seed jen B2C+B2B.
1. Migrace + seed systémových katalogů (B2C=default `INHERIT_ALL`, B2B `INHERIT_ALL`,
   aby „B2B vidí celý store" zůstalo). Přemapuj všechna pravidla vč. 5_2 (§3, §5).
2. `core/catalog/catalog.resolver.ts`: `resolveCatalog({ matchedTags,
   hasPurchasingCompany, marketContext, catalogs }) → catalogId` (nejvyšší priorita;
   company i market filtr; fallback default). `resolveSegment` ponech jako tenký adaptér.
3. `core/config/function-config.ts`: nový `buildCatalogFunctionConfig` →
   `{ default, catalogs: { [id]: …DELTY… }, catalogTags, … }`. Starý `*B2C/*B2B` tvar
   buď zachovej jako derivovaný shim, nebo rovnou přepiš contract testy.
4. JS funkce: `resolveCatalogId` + `effective = merge(default, catalogs[id])`; nahraď
   `isB2B ? …B2B : …B2C` čtením z `effective`. Vstupní query: `hasTags($catalogTags)`
   + `localization.country`.
5. Contract testy `function-runtime-config-compat`, `shopify-function-config-contract`:
   ověř `merge(default, delta) === starý B2B/B2C výsledek`.
VÝSTUP: `guard:test:core` zelená, `tsc` čistý, e2e beze změny chování.

## 8) FÁZE 2 — N katalogů v adminu
- CRUD route „Catalogs" + editor s taby: Audience | Membership | Price list | Floor |
  Slevy | Množství | Market. Sdílené view komponenty (move-not-copy), jeden handler/faseta.
- Audience: tagy + priorita + company; Market filtr (§6).
- Membership: opt-in picker (čte `CatalogProduct`); systémové katalogy `INHERIT_ALL`.
- Price list FULL parity (§4) na úrovni produktu i varianty; podpoř oba vzory Q1
  (kartón-jako-varianta i quantity-driven). Per-variant popis = variant metafield
  renderovaný theme app extension (Shopify varianta nemá description) — nepovinné.
- Floor/Slevy/Množství per katalog (dědí z defaultu); variant-level kde dává smysl.
- Cross-cutting read čočka „po fasetě napříč katalogy" (jako MVP_5_1 Product Rules panel).

## 9) FÁZE 3 — Enforcement + projekce ve velkém
- Funkce: dotáhni price-list parity v discount-function (per-collection % přes
  `inCollections`). Cart-validation čte floor/qty z merged configu rozřešeného katalogu.
- `storefront-projection.server.ts`: per-katalog projekce s DELTA-encodingem; katalog
  rozřeš klientsky z customer tagu (+ market). Hlídej velikost metafieldu (delta drží
  malé); při riziku stropu varuj v adminu. Zachovej anti-flash chování z MVP_5_0_2.
- Variant visibility per katalog (kartón viditelný jen ve wholesale apod.).

## 10) Invarianty / guardrails
- Value-based, source-agnostic cart-validation backstop ZŮSTÁVÁ (floor z merged configu).
- TS (core, admin/preview) a JS (funkce) v syncu přes contract testy.
- Delta-encoding: katalog NIKDY neukládá hodnoty shodné s defaultem.
- Žádná duplikace dat ani UI (move-not-copy). Default katalog je vždy přítomný a fallback.

## 11) Non-goals
- Netvořit native-only typy slev (fixed-amount order, BXGY, bundle, free shipping,
  usage limits, scheduling) — appka je jen governuje.
- Neintegrovat Shopify native catalog API (plná simulace).
- Nesimulovat měnovou konverzi/rounding/domény/jazyky — to je Shopify Markets.
- Auto spend-based přiřazení loyalty tieru (Protected Customer Data) — mimo 5_3.

## 12) Testy (každá vrstva, dle TESTING_POLICY)
- unit: `catalog.resolver` (priorita/company/market/fallback), price-list precedence,
  delta merge, per-catalog conflict detector.
- contract: `buildCatalogFunctionConfig` (delta), funkce config-compat, projekce shape.
- runtime integration: funkce s fake adminem (resolve+merge+floor+price override+market).
- storefront e2e: per-katalog cena/viditelnost (graceful-skip bez živého shopu).
</content>
</invoke>
