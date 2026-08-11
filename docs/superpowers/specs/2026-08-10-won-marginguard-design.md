# WonMarginGuard — design spec

> Brainstorm 2026-08-10. Stav: **spec k ranní review**, poté → writing-plans.
> Kanonické krátké shrnutí + rozhodnutí žijí i v roadmapě (`docs/product-roadmap.html`,
> karta Won MarginGuard) a v paměti `won-cart-suite-souls-limits`.

## 1. Duše, díra, pozicování

**Duše:** slevový hub, jehož duší je **ochrana + přesnost**, ne „víc typů slev".
Všechny přímé slevy a kódy žijí v MarginGuardu, protože jen tam drží merchantovy
**výjimky (až na úroveň varianty)** a **marže** — sleva nikdy nespadne pod floor.

**Díra:** dnes je vyloučení outletu/dárkových karet/sad/dárků ze slev ruční admin
operativa (origin: Enervit). Konkurence prodává *tvorbu* slev; Won prodává
*„slevy, co ti neprožerou marži a poslechnou tvoje výjimky — až na úroveň varianty"*.

**Klíčový technický fakt, který určuje celou architekturu:** exkluzi ani floor
**nejde zaručit** u cizí slevy — Shopify Functions se navzájem nevidí a běží
konkurentně; nativní „amount off order" neumí vyloučit řádek; `compare_at` sleva
stále bere kódy. **Proto slevy musí žít v MarginGuardu** (plné pojetí „hub").

## 2. Hranice (anti-blur)

MarginGuard vlastní **jen přímé %/fixní slevy** (produkt/varianta/kolekce/order),
automatické i kódové. Sousedé v suite Pricing & Margin:

| App | Vlastní | Vyloučení/floor |
|---|---|---|
| **Won Tiers** | množstevní slevy (qty breaks) | čte sdílený ruleset |
| **Won Rewards** | dárky + doprava zdarma (prahy) | čte sdílený ruleset |
| **Won Outlet** | lifecycle výprodeje | **zapisuje** exclusion tagy |
| **WonMarginGuard** | přímé slevy + kódy **a** vlastní sdílený exclusion/floor ruleset | **je autorita** |

- **BOGO / buy-X-get-Y**: až pozdější MVP (na start ne).
- **Free-shipping goal** = Rewards; free-shipping *kód* jako přímý discount je
  hraniční kandidát, ne v prvních MVP.
- Sdílená autorita = exclusion/floor pravidla žijí v `packages/core/src/margin/`
  a **čte je Function každé Won pricing appky** (self-exclude — žádné cross-Function
  veto). MarginGuard je vlastní/edituje; sourozenci konzumují; Outlet píše tagy.

## 3. Architektura

```
Admin (Polaris, React Router)                Storefront
  │  authoring slev + exclusion + floor         (žádné storefront JS;
  │  migrace (backup/dry-run/rollback)            volitelně badge app block
  ▼                                               "výprodejová cena je konečná")
Prisma (app DB)  ── mirror ──▶  App metafield (jsonValue)
  MgDiscount / ExclusionRule / FloorRule          │
  MigrationBackup                                 ▼
                                        Shopify Discount Function (Rust)
                                        cart.lines.discounts.generate.run
                                        + (MVP2) cart.delivery-options…run
                                          - čte config z discount.metafield
                                          - aplikuje %/fix na NE-vyloučené řádky
                                          - CLAMP: cena ≥ floor
  Admin GraphQL (migrace):
    read discountNodes → backup → recreate as app discount → deactivate native
```

**Reuse z `packages/core` (velký):**
- `margin/floor.rules.ts` — `FloorRuleset`, `ProductFloorRule` (rozšířit o `basis`).
- `margin/margin.guard.ts` — `validateMargin` (vrací `BELOW_FLOOR`/`floorPrice`/`violationAmount`).
- `margin/conflict.detector.ts` — `detectDiscountFloorConflicts` (dry-run/migrace: hlásí, kde by kombinace prolomila floor).
- `discount/discount.rules.ts` + `discount.orchestrator.ts` (`resolveDiscounts`) — model a rozhodování slev.
- `discount/coupon-segment.rules.ts` (`validateCouponsBySegment`) — segmentové kódy (Pro).
- Vzor exkluze: `toasts/exclusions.ts`.

**Nové v `packages/core`:**
- `margin/exclusion.rules.ts` — `isExcluded({ line, rules })` pro kind
  `collection|tag|productType|giftCard|product|variant`; framework-free, `node:test`.
- `FloorRule.basis: "sellingPrice" | "compareAt"` (default `sellingPrice`).

## 4. Datový model (Prisma, verzovaný config)

```
MgDiscount     { shop, id, kind: "percentage"|"fixed", value, appliesTo (order|line),
                 method: "automatic"|"code", code?, combinesWith(JSON), enabled,
                 startsAt?, endsAt?, usageLimit? }
ExclusionRule  { shop, id, kind: collection|tag|productType|giftCard|product|variant,
                 value, enabled }
FloorRule      { shop, id, scope: global|product|variant, targetId?, segment?,
                 minPercentOfBase, basis: sellingPrice|compareAt, allowZeroFinalPrice }
MigrationBackup{ shop, id, createdAt, payload(JSON: raw discountNodes snapshot),
                 status: captured|migrated|rolledBack }
```
Vše se **zrcadlí do app metafieldu** (`jsonValue`) pro Function (Function nemá DB přístup).

## 5. Floor (srdce)

Function čte per-řádek `cost.amountPerQuantity` (aktuální cena) a
`cost.compareAtAmountPerQuantity` (původní). Floor a clamp:

```
base  = basis === "compareAt" ? (compareAt ?? selling) : selling
floor = base * (minPercentOfBase / 100)
maxSleva    = max(0, aktuálníCena − floor)
reálnáSleva = min(chtěnáSleva, maxSleva)      // nikdy záporné; nikdy pod floor
```
- **Default basis = `sellingPrice` (A)**; per-produkt toggle na `compareAt` (B) = **Pro**.
- **Cenový** floor = Free core. **Cost-based** marže (COGS přes Admin API
  `inventoryItem.unitCost` → metafield) = **Pro** (COGS není v inputu Function).
- Když se slevy oříznou floorem → **zaznamenat** (Insights: „sleva capnutá floorem
  na produktu X"), `validateMargin`/`conflict.detector` už to umí.

## 6. Guarantee scope & stacking

Floor/exkluze drží **jen u slev, které MarginGuard počítá**. Cizí nativní/app sleva
navrch (Function o ní neví) může floor prolomit → obrany:
1. **Stacking/combination control** v adminu — `combinesWith` na MarginGuard slevách
   (nekombinovat na floored produktech).
2. (Pozdější) **Cart-Checkout-Validation Function** jako tvrdý guard — blokne checkout,
   když řádek prorazí floor.

## 7. Migrace (bezpečnostně-kritický subsystém, MVP3)

One-click přenos nativních Shopify slev do MarginGuardu:
`Backup → Dry-run → Migrate → Report` + **Rollback**.
1. **Backup:** plná lokální záloha nativních slev (`discountNodes` snapshot do
   `MigrationBackup`) PŘED čímkoli.
2. **Dry-run:** report — co se namapuje (přímé %/fixní), co ne a **proč** (BOGO,
   qty-tiery, free-shipping, …), co domigrovat ručně. Žádné mutace.
3. **Migrate:** vytvoří MarginGuard verze supported tvarů (`discountAutomaticAppCreate`
   / `discountCodeAppCreate`) + **deaktivuje nativní** (kód nutně smazat/vypnout kvůli
   unikátnosti PŘED vytvořením MarginGuard verze).
4. **Report** + **Rollback** ze zálohy (obnoví nativní, sundá MarginGuard verze).

> Detailní migratable/non-migratable matice a Admin API volání: viz implementation
> plan (doplněno z research běhu `wk4x88ud0`).

## 8. Free / Pro (Pro gatuje scope, ne kvalitu)

- **Free:** exkluze všech druhů + **price floor** + přímé slevy (auto i kód) +
  migrace/rollback + **až 50 aktivních slev**.
- **Pro:** cost-based floor (COGS), segment/B2B floory, **Insights**
  (capnuté slevy, nejčastěji vyloučené produkty), scheduling, pokročilý stacking,
  basis-B toggle, custom badge.

## 9. Admin / storefront plocha

- Admin (sdílený Won Admin System tvar): Overview → Discounts → Exclusions → Floors
  → Migration → Insights (Pro) → Plan. Human-label mapy, live preview kolik produktů
  pravidlo pokrývá.
- **Žádné storefront UI**; volitelně mini app block badge „výprodejová cena je konečná".

## 10. Testing

- **Core (`node:test`, červená první):** `exclusion.rules` (všech 6 kindů + variant),
  floor clamp (basis A/B, compare-at, zaokrouhlení, allowZeroFinalPrice),
  `validateMargin` hranice, `conflict.detector` (kombinace prolomí floor).
- **Function unit:** `shopify app function run` proti `input.json` (vyloučená vs
  slevitelná varianta; floor clamp; kód aplikován/neaplikován).
- **Integrace:** `discountAutomaticAppCreate` + cart `simpleA`+`simpleB`
  (slevu dostane jen `simpleA`); ověřit `/cart.js` discount allocations (Horizon/Dawn).
- **Migrace:** dry-run report na fixture nativních slev; rollback vrátí stav.
- **Gate:** `test:unit`, `typecheck`, `build -w won-marginguard` (vč. Function),
  `validate:shopify`.

## 11. MVP žebřík (Approach 1 — ochrana první, migrace izolovaně; každý krok shippable, TDD)

- **MVP0 — skeleton.** Klon `_template`, Prisma `MgDiscount`/`ExclusionRule`/`FloorRule`,
  Function scaffold (no-op), config proxy + metafield mirror.
- **MVP1 — authoring + ochrana (DUŠE, shippable).** 1 automatická %/fix sleva authored
  v appce + exkluze (kolekce/tag/typ/gift-card/produkt/varianta) + price floor (basis A).
  Function aplikuje/vylučuje/clampuje. Reuse margin core; nový `exclusion.rules.ts` +
  `FloorRule.basis`.
- **MVP2 — kódy + stacking.** Kódové slevy (`enteredDiscountCodes`) +
  stacking/combination control v adminu.
- **MVP3 — migrace.** Backup/dry-run/migrate/report/rollback jako samostatný bezpečný
  subsystém.
- **MVP4 — sdílená autorita.** Ruleset čtou Tiers/Rewards/Outlet (self-exclude);
  Outlet píše tagy.
- **MVP5 — Pro.** Cost-based floor (COGS), segment/B2B floory, Insights, scheduling,
  basis-B toggle, billing.

## 12. Otevřené otázky (k ranní review)

- Cena appky ($2/mo flat) — potvrdit při rozšíření na hub, nebo přehodnotit.
- Free-shipping *kód* jako přímý discount — pustit do hubu (post-MVP), nebo držet ven.
- Přesná podoba „Stacking control" UI (kombinace `combinesWith`).
