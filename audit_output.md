# Audit Report — b2b_b2c / Margin Guard
*Datum: 2026-03-17 | Nástroj: Claude Sonnet 4.6 | Read-only, žádné code changes nebyly provedeny.*

---

## 1. Findings

### P0 — Kritické

---

#### P0-1: Prisma schema hardcodes SQLite file path — nekompatibilní s multi-tenant / produkčním nasazením

**Soubor:** `prisma/schema.prisma`, řádek 13

```
url = "file:dev.sqlite"
```

**Dopad:** Shopify apps jsou ze své podstaty multi-tenant. Aktuální schéma používá jedinou SQLite databázi s jedním řádkem `MarginGuardConfig` (`id = "default"`) pro všechny shopy. Pokud bude appka nainstalována ve více obchodech, všechny budou sdílet jednu konfiguraci. Žádný záznam v `MarginGuardConfig`, `ProductFloorRule`, `CouponSegmentRule` ani jinde nemá sloupec `shop`.

**Důkaz:** `app/services/margin-guard-config.server.ts`, řádky 4–5 a všechny queries s `configId = "default"`. Schema `prisma/schema.prisma` nemá `shop` field v žádném business modelu.

**Oprava:** Buď explicitně zdokumentovat, že jde o single-tenant app (přidat assertion při každém requestu), nebo přidat `shop: String` do `MarginGuardConfig` a všech child tabulek. Pro produkci přejít z SQLite na PostgreSQL.

---

#### P0-2: Dockerfile neexpozuje DB volume — při každém restartu kontejneru se ztratí data

**Soubor:** `Dockerfile`

Produkční Docker build dělá `npm run docker-start` → `prisma migrate deploy`, aplikuje migrace na `dev.sqlite` v `/app/prisma/dev.sqlite`. Dockerfile neobsahuje žádný `VOLUME /app/prisma` ani `DATABASE_URL` v ENV. Při každém restartu kontejneru se stav databáze ztratí.

**Oprava:** Přejít na `url = env("DATABASE_URL")` v `schema.prisma`, nastavit `DATABASE_URL` v Docker a CI, přidat volume mount pro SQLite nebo přejít na PostgreSQL.

---

### P1 — Vysoká závažnost

---

#### P1-1: Feature flags jsou dead code — auto-disable discount funkce je dvoukolejná logika

**Soubory:** `config/feature-flags.ts`; `app/services/discount-function-activation.server.ts`, řádky 245–266

`config/feature-flags.ts` existuje s flagy `enableMVP1..6`, ale v celé appce (`app/`, `core/`) není **ani jedno** použití `featureFlags`. Mezitím `getDiscountFunctionStatusWithAutoDisable()` provádí auto-deaktivaci discount funkce při každém loaderu bez vazby na feature flags. Logika řízení funkčnosti je tedy dvoukolejná: feature flags jsou dead code, skutečná kontrola je skrytá v service vrstvě.

Navíc `getDiscountFunctionStatusWithAutoDisable(admin)` je voláno ze tří různých route loaderů: `app._index.tsx` (řádek 15), `app.settings.tsx` (řádek 46), `app.violations.tsx` (řádek 10). Každé načtení libovolné admin stránky provede API volání do Shopify. Tři zbytečné roundtrips.

**Oprava:** Buď napojit auto-disable logiku na `featureFlags.enableMVP2`, nebo feature flags úplně odstranit jako dead code. Centralizovat auto-disable do root loaderu nebo shared middleware.

---

#### P1-2: `b2bTag` z adminu nemusí být propagován do Shopify Functions při starém metafieldu

**Soubor:** `extensions/margin-guard-cart-validation/src/cart_validations_generate_run.graphql`, řádek 2

```graphql
$b2bTags: [String!]! = ["b2b"]
```

Pokud `b2bTags` v metafieldu není přítomno (stará konfigurace, metafield bez `b2bTags` — např. před sync), query použije fallback `["b2b"]`. Merchant s tagem `wholesale` pak nebude detekován jako B2B při cart validation.

**Dopad:** Zákazníci s custom `b2bTag = "wholesale"` projdou cart validation jako B2C při nesynced metafieldu — obejdou B2B-specifická omezení (vyšší MOQ, jiný floor).

**Oprava:** Přidat assertion v `ensureCartValidationActive`, která ověří, že metafield byl skutečně updatován a obsahuje `b2bTags`. Contract test ověřující přítomnost a neprázdnost `b2bTags`.

---

#### P1-3: `cart-validation-violation-sync.server.ts` — duplicitní ternár s identickými větvemi

**Soubor:** `app/services/cart-validation-violation-sync.server.ts`, řádky 235–238

```typescript
const violationAmount =
  finalPrice <= 0 && !lineAllowZero
    ? roundMoney(Math.max(0, floorPrice - finalPrice))
    : roundMoney(Math.max(0, floorPrice - finalPrice));
```

Obě větve ternárního operátoru jsou identické. Původní záměr byl zřejmě použít `floorPrice` jako `violationAmount` pro `ZERO_FINAL_PRICE_NOT_ALLOWED` případ (analogicky k `margin.guard.ts`), ale výsledek neodpovídá logice `validateMargin`. Violation log z `syncLiveCheckoutViolationsFromFunctionLogs` tak ukazuje jiný `violationAmount` než violation log z `webhooks.orders.create` nebo `api_cart_validation`.

**Dopad:** Nekonzistentní violation log mezi různými sources. Readme.txt (MVP_5_5) explicitně zmiňuje "Vyřešit duplicitní log cart validation".

**Oprava:** Opravit ternár tak, aby odpovídal logice v `margin.guard.ts`, nebo přepsat funkci jako volání `validateMargin` + `evaluateOrderLine`.

---

#### P1-4: Coupon segment validation chybí v cart validation function — enforcement pouze přes discount function

**Soubory:**
- `extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js`, řádky 242–299 — `couponSegmentRules` je parsován a validován
- `extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js` — `couponSegmentRules` neobsahuje vůbec

Pokud zákazník manuálně zadá nepovolenou kombinaci kupónu + segment, cart validation to **nezablokuje**. Discount sice nebude aplikován, ale checkout není zastaven.

**Dopad:** Zákazník může zadat B2B kupón jako B2C — kupón nebude aplikován (discount function ho odmítne), ale checkout projde bez chyby a zákazník dostane normální cenu bez hlášky proč.

---

### P2 — Střední závažnost

---

#### P2-1: `MarginGuardConfig.id = "default"` sdíleno pro všechny shopy — P0-1 v detailu

`recordMarginViolation` přijímá `shop: string` a ukládá do `MarginViolationLog.shop`, ale `getOrCreateMarginGuardConfig()` nikdy nebere `shop` jako parametr. Toto je interně konzistentní pro single-tenant, ale není nikde zdokumentováno jako architektonické rozhodnutí.

---

#### P2-2: `app.api.cart-validate.tsx` autentizuje přes `authenticate.admin` — nelze volat ze storefrontu

**Soubor:** `app/routes/app.api.cart-validate.tsx`, řádek 8

Endpoint slouží k validaci košíku, ale je dostupný pouze z embedded admin appky. Storefront JavaScript ho nemůže volat. Skutečná enforcement probíhá přes Shopify Function, takže nejde o bezpečnostní díru, ale API kontrakt je matoucí.

---

#### P2-3: `pricing.engine.ts` — priorita tier vs. b2bOverridePrice je konzistentní, ale nedokumentovaná

**Soubory:**
- `core/pricing/pricing.engine.ts`, řádky 60–63: `appliedTierPrice?.unitPrice ?? b2bOverridePrice ?? basePrice` — tier wins
- `extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js`, řádky 887–898: stejná priorita

Priorita je konzistentní mezi TS core a JS extensions (tier > override), ale není nikde dokumentovaná. Při budoucí změně prioritního pořadí hrozí neúmyslná divergence.

---

#### P2-4: `app.violations.tsx` — violations ze Shopify Function jsou v produkci logovány pouze přes `orders/create` webhook

**Soubor:** `app/routes/app.violations.tsx`, řádky 9–12

`syncLiveCheckoutViolationsFromFunctionLogs` čte soubory z `.shopify/logs` — lokální dev logy. V produkci tato cesta neexistuje. Violations z function jsou v produkci logovány pouze přes `webhooks/orders/create`, ale webhook nemá `Protected Customer Data` access (zmíněno v readme.txt), takže plné logování není dostupné.

---

#### P2-5: `shopify.app.toml` — placeholder URLs s `include_config_on_deploy = true`

**Soubor:** `shopify.app.toml`, řádky 5, 13, 37

`application_url`, `app_proxy.url` a `auth.redirect_urls` ukazují na `https://example.com`. `automatically_update_urls_on_dev = true` zajistí update v dev módu, ale `include_config_on_deploy = true` způsobí, že placeholders se dostanou na produkci při `npm run deploy`.

---

### P3 — Nízká závažnost / technický dluh

---

#### P3-1: `functions/` directory — dead code stubs s nefunkčními TOML soubory

**Soubory:** `functions/cart-validation/shopify.extension.toml`, `functions/discount-function/shopify.extension.toml`

Skutečné produkční extensions jsou v `extensions/margin-guard-cart-validation/` a `extensions/margin-guard-discount-function/`. Adresář `functions/` obsahuje TS verze `validateCartLine` a `applyDiscountFunction` volané z admin API endpointů, ale jejich vstupní typy (`PricingPipelineInput`) se neshodují se vstupem Shopify Function. TOML soubory v `functions/` nemají `uid`, `api_version` ani `build.path` — jsou nefunkční. Situace mate orientaci v codebase.

---

#### P3-2: `config/feature-flags.ts` — kompletně dead code

Soubor definuje flagens, ale není nikde použit. Viz P1-1.

---

#### P3-3: `types/global.types.ts` — `AuditLogEntry` interface není nikde implementován

Interface pro RULE_CHANGE audit log je definován, ale nepoužit. Plánováno pro MVP_6, ale vytváří false promise o stavu implementace.

---

#### P3-4: `shopify.app.toml` — šablonové artefakty z Shopify template

**Soubor:** `shopify.app.toml`, řádky 39–62

`[product.metafields.app.demo_info]` a `[metaobjects.app.example]` jsou pozůstatky z Shopify app template. Vytvoří se v merchantově obchodě při každém deployi a znečišťují jejich admin.

---

#### P3-5: `CartValidationsGenerateRunInput` — `purchasingCompany` fallback cesty jsou neúplné vs. webhook handler

**Soubory:**
- `extensions/margin-guard-cart-validation/src/cart_validations_generate_run.graphql`, řádky 6–15 — čte pouze `buyerIdentity.purchasingCompany`
- `app/routes/webhooks.orders.create.tsx`, řádky 107–112 — rozpoznává `buyer_identity.purchasing_company`, `customer.purchasing_company`, root-level `purchasing_company`

Cart validation function nemá všechny fallback cesty pro purchasingCompany detekci jako webhook handler. Shopify Function cart API má jiný tvar dat než Orders REST API — potenciální nekonzistence.

---

#### P3-6: `CollectionQuantityRule` v Prisma schema nemá `minimumOrderQuantity`

**Soubor:** `prisma/schema.prisma`

MVP_3 roadmap zmiňuje "Collection-level MOQ", ale `CollectionQuantityRule` model má pouze `maxOrderQuantity`. `minimumOrderQuantity` pro kolekce není v schema — tato MVP_3 položka je tedy neimplementovaná.

---

## 2. MVP stav

| MVP | Stav | Detaily |
|-----|------|---------|
| **MVP_1** Margin Guard Core | ✅ Hotovo | Segment detection, global/per-product floor, discount stacking, Discount Function, Cart Validation, admin UI, violation log |
| **MVP_1.5** Margin Guard 2.0 | ✅ Hotovo | Custom `b2bTag` konfigurace v adminu, dynamické čtení v core logice |
| **MVP_2** B2B Pricing Lite | ✅ Hotovo | Advanced segment engine (včetně `hasPurchasingCompany`), B2B price override, tier pricing, coupon segment validation, product visibility |
| **MVP_3** Quantity & Operational Rules | 🔧 Dokončuje se | MOQ, step, product max, collection max, customer max jsou v DB/services/core/function/admin. Chybí: collection-level MOQ (pouze max, ne min — P3-6), "Rozumím" confirm button (MVP_3.5) |
| **MVP_3.5** | ❌ Nezačato | Variant visibility (kusovka/karton) a confirm button na violation hlášky nejsou v kódu |
| **MVP_4–7** | ❌ Nezačato | — |

**Aktuální pozice: MVP_3 se dokončuje, MVP_3.5 nezačato.**

---

## 3. Open Questions / Assumptions

1. **Multi-tenant záměr:** Není zdokumentováno, zda je app záměrně single-tenant (one merchant) nebo se plánuje distribuce přes app store. Pokud distribuce, P0-1 je blokující — migrační náklady budou velmi vysoké.

2. **Shopify Function `input.variables` binding:** Předpokládám, že `[extensions.input.variables]` v toml skutečně injektuje `b2bTags` a `collectionIds` z metafield JSON jako query proměnné. Pokud ne, B2B detekce je rozbita pro non-default tag. Toto nelze ověřit statickou analýzou.

3. **SQLite produkční instance:** Dockerfile a `prisma:migrate:deploy` jsou nastaveny pro SQLite. Předpokládám aktuálně single-instance deploy. Při více instancích by SQLite kolidovalo.

---

## 4. Overall Risk Summary

Projekt je technicky solidně napsaný na úrovni core business logiky. Testy pokrývají klíčové domény (margin, pricing, quantity, visibility, coupon, cart validation extensions). Architektura `core/ → app/services/ → routes` je dodržena.

**Hlavní rizika:**

- **Architektonická bomba (P0-1):** Celý datový model je single-tenant s hardcoded `"default"` config ID. Pokud appka bude distribuována, toto je blokující a migrační náklady budou velmi vysoké.
- **Produkční databáze (P0-2):** SQLite + žádný DB volume v Dockeru = ztráta dat při každém restartu kontejneru.
- **Dead code infra (P1-1, P3-1, P3-2):** Feature flags soubor, `functions/` directory stub — aktivně matou orientaci v codebase.
- **Violation log nekonzistence (P1-3):** Bugedn ternár způsobuje rozdílné `violationAmount` napříč sources.
- **Auto-disable discount funkce (P1-1):** 3× zbytečný Shopify API roundtrip na každé admin page load.

Projekt je ve stavu **"fungující MVP pro jednoho merchantele"**, nikoli "production-ready multi-tenant SaaS".

---

## 5. Testing Gaps

1. **Tier pricing priority při quantity pod threshold** — chybí test, který ověří, že při `quantity < tier.minQuantity` se použije `b2bOverridePrice` a ne `basePrice`. Aktuální test testuje jen případ, kdy quantity threshold je splněn.

2. **Multi-code stacking s B2B + B2C kupónem pro B2B zákazníka** — `resolveRejectedDiscountCodes` zpracovává kódy v pořadí vstupu. Chybí test: bude RETAIL-ONLY kód odmítnut jako segment mismatch nebo jako stacking violation?

3. **`normalizeCollectionId` s plain-text string** — funkce vrátí `null` pro non-GID, non-numeric string. Chybí test ověřující, že admin UI s takovým vstupem zachytí chybu a zobrazí ji uživateli.

4. **`app.api.cart-validate.tsx` end-to-end flow** — validace košíku přes admin API endpoint není pokryta žádným integračním testem. `tests/cart/cart-validation-blocking.test.ts` testuje pouze pure function.

5. **`isAlreadyExistsMessage` heuristika** (`cart-validation-activation.server.ts`, řádek 50) — detekuje "already" + "validation" v error message. Nulové testovací pokrytí.

6. **`b2bTag` custom tag propagation end-to-end** — chybí test celé cesty: admin nastaví `b2bTag = "wholesale"` → `buildCartValidationFunctionConfig` vrátí `b2bTags: ["wholesale"]` → metafield je uložen → cart validation function používá `wholesale` tag pro `hasAnyTag`.

7. **`CollectionQuantityRule` — chybějící `minimumOrderQuantity`** — chybí test, který odhalí mezeru mezi MVP_3 roadmapou a aktuálním Prisma schematem.

---

## 6. Architektonická Doporučení

### 6a. Single-tenant vs. multi-tenant — explicitní rozhodnutí

Přidat assertion na začátek každého admin route loaderu ověřující, že `session.shop` odpovídá očekávanému shopu (pokud single-tenant). Nebo naplánovat migraci na shop-scoped konfiguraci před distribucí — přidání `shop: String` do `MarginGuardConfig` a všech child tabulek s `@unique([configId, shop])`.

---

### 6b. `functions/` directory — odstranit nebo přesunout

TypeScript adaptéry `validateCartLine` a `applyDiscountFunction` z `functions/cart-validation/src/index.ts` přesunout do `app/services/`. Odebrat prázdné TOML soubory z `functions/`, které nejsou funkčními Shopify extensions. Tím zmizí false impression, že server-side TS funkce je totéž co Shopify Function WASM.

---

### 6c. Feature flags — napojit nebo smazat

`config/feature-flags.ts` buď napojit do relevantních service souborů (např. `if (!featureFlags.enableMVP2) return { ok: false }`), nebo soubor smazat. Dead code soubor je horší než žádný soubor.

---

### 6d. `getDiscountFunctionStatusWithAutoDisable` — centralizovat do root loaderu

Místo tří nezávislých volání z loader funkcí použít centrální app-level state (React context nebo root loader), který provede auto-disable jednou a výsledek předá všem routám.

---

### 6e. `buildCartValidationFunctionConfig` — rozdělit 400+ řádkový monoblok

Funkce v `core/config/function-config.ts` provádí všechny transformace v jednom průchodu. Doporučení: rozdělit na helper funkce `buildFloorMaps`, `buildTierMaps`, `buildQuantityMaps`, `buildCollectionMaps`, `buildVisibilityMaps`, `buildCouponMaps`, každou testovatelnou samostatně. Aktuální integrační testy v `shopify-function-config-contract.test.ts` jsou dobré, ale unit-level testy pro každou mapovací skupinu chybí.

---

### 6f. Violation log — sjednotit výpočet

Tři místa počítají `violationAmount` různými způsoby: `margin.guard.ts`, `orders-create-webhook.server.ts` (volá `validateMargin`), `cart-validation-violation-sync.server.ts` (vlastní logika s bugedem ternárem). Přepsat `cart-validation-violation-sync.server.ts` tak, aby interně volal `validateMargin` místo duplicování logiky.

---

### 6g. `DATABASE_URL` přes environment variable

Změnit `prisma/schema.prisma` z `url = "file:dev.sqlite"` na `url = env("DATABASE_URL")` a nastavit `DATABASE_URL` v `.env`. Standardní přístup umožňující nasazení bez změn schema souboru. Přidat `VOLUME /app/prisma` do Dockerfile nebo přejít na externě managovanou databázi.

---

*Audit proveden: 2026-03-17 | Nástroj: Claude Sonnet 4.6 | Read-only, žádné code changes nebyly provedeny.*
