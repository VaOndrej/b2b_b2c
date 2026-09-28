# Won Discounts MVP 1 — Engine + Slevy a kódy + přesun nativních slev (implementační plán)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §0–§5, §9, §10 (MVP 1), §11
> verdikty. Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md). Podklad k pořadí:
> `docs/won-discounts/paralelizace.md` (krok 0 = zmrazit kontrakty, pak pruhy s disjunktními soubory).

**Goal:** Kód i automatická sleva z Won Discounts platí v košíku i pokladně (Bogus) na Horizon
+ Dawn; nativní slevy obchodu jdou detekovat, jedním tlačítkem přesunout do Won a vrátit zpět;
admin ukáže Přehled v1, modul Slevy a kódy, Vyzkoušet košík a onboarding kroky 1–3.

**Architecture:** Čistý engine `planCart` v `@won/core/discounts` (DATA-4) běží beze změny ve
funkci (bundlovaný do JS funkce), v adminu (Vyzkoušet košík) i později ve storefrontu. Config
pro funkci je **jeden sdílený shop metafield** (atomický zápis, všechny uzly čtou totéž — odpověď
na audit P2-8), každý uzel má jen malé proměnné `function_vars` (role, pravidlo, okno kampaně)
a cílení na produkty/kolekce se předpočítá do **produktových metafieldů** (dotaz funkce má
rozpočet 24/30, sloty kolekcí se nevejdou). Sync vrstva je jediný zapisovatel do Shopify.

**Tech Stack:** jako MVP 0 + Admin GraphQL 2026-04 (discount mutace, metafieldsSet), Polaris web
components, Playwright checkout přes Bogus.

## Global Constraints

- Vše z plánu MVP 0 (dev store only, žádný deploy, sahat jen na `apps/won-discounts/**`,
  `packages/**`, `docs/**`, `tests/**`; core mění 1 subagent najednou; nečíst tajné soubory).
- Uzly (spec §3): 1 automatický uzel + 1 kódový uzel na kódové pravidlo; na řádek emituje
  nejvýš 1 uzel 1 produktovou alokaci; hodnotu kódu vydává jen jeho uzel.
- Proměnné uzlu vždy obsahují `campaignStart` + `campaignEnd` (C4). Rozpočet configu 9 000 B.
- Kombinování A1: výprodej s ničím; produkt vs. produkt = výhodnější pro zákazníka; produkt +
  objednávka + doprava se sčítají; objednávka vs. objednávka = výhodnější [spec].
- Měna: hodnoty per měna v minor units, trh bez hodnoty = pravidlo se nenabízí (MKT-1).
- Funkce nikdy nevyhodí výjimku ani neblokuje checkout.
- Admin: Czech + English podle jazyka adminu (A10), žádné raw enumy (§4c), sekce vede stavem (§17),
  každá otázka = jedno tlačítko (§13), Pro prvky amber a viditelné (§16), BILL-1 na serveru.
- Každá obrazovka = komponenta v `app/components/screens/*`, renderuje ji route i dev harness.

---

## Mapa souborů (vlastníci úkolů)

| Oblast | Soubory | Úkol |
|---|---|---|
| Prototyp transportu | `scripts/prototypes/c7-shop-metafield.mjs`, evidence | T0 |
| Engine (core) | `packages/core/src/discounts/{cart,plan,combine,explain,emit,targeting,function-payload}.ts` + testy | T1 |
| Funkce | `extensions/won-discounts-engine/**` | T2 |
| Sync vrstva | `app/lib/sync/**`, `app/lib/admin-client.ts`, Prisma `WonNode` | T3 |
| Nativní slevy | `app/lib/native/**`, Prisma `NativeDiscountBackup` | T4 |
| Admin UI | `app/components/**`, `app/routes/app.*`, `app/i18n/**`, harness | T5 |
| E2E | `tests/e2e/checkout.*.spec.ts`, `tests/e2e/support/**`, `scripts/e2e/**` | T6 |

Prisma: T3 a T4 přidávají modely jednou společnou migrací, kterou vytvoří **T3** (T4 dostane
hotové modely) — paralelní migrace se nemergují.

---

### Task 0: Prototyp transportu (C7) — shop metafield + produktový metafield ve funkci

**Otázka:** Čte discount funkce `shop { metafield(namespace: "$app:won_discounts", key: "function_config") { jsonValue } }`
(app-owned shop metafield zapsaný `metafieldsSet` s `ownerId` = shop GID)? Platí pro něj limit
10 000 B stejně? Funguje `[extensions.input.variables]` s metafieldem `function_vars` na uzlu,
zatímco config jde ze shopu?
- Dočasně rozšířit dotaz funkce o `shop.metafield(...)` a prototypový mód `shop_config`
  (sleva = `shopConfig.percent`), vytvořit 1 automatický uzel, zapsat shop metafield, košík →
  sleva. Úklid. Důkaz → `docs/won-discounts/evidence/mvp1/c7-*.json`.
- **Verdikt „platí“** → architektura výše. **Fallback** (předem zvolený): config kopírovaný do
  každého uzlu (stav MVP 0) + sync zapisuje všechny uzly a verzi configu; Přehled ukáže
  „synchronizace neúplná“, když se verze uzlů liší.

### Task 1: Engine `planCart` (core, jediný zapisovatel `packages/core`)

**Produces:**
```ts
// cart.ts — normalizovaný košík (adaptéry žijí u konzumentů)
export interface CartLineInput { id: string; variantId: string; productId: string; quantity: number;
  unitPrice: number /* minor */; compareAtUnitPrice?: number; outlet?: boolean; giftTierId?: string;
  ruleIds: readonly string[] /* předpočítané cílení z produktového metafieldu */ }
export interface CartPlanInput { currency: string; countryCode?: string; lines: CartLineInput[];
  enteredCodes: string[]; campaignActiveId?: string | null; now?: string /* shop-local, jen admin */ }
// plan.ts
export function planCart(input: CartPlanInput, config: FunctionConfigPayload): CartPlan;
// emit.ts
export type NodeRole = { kind: "automatic" } | { kind: "code"; ruleId: string };
export function emitForNode(plan: CartPlan, role: NodeRole, triggeringCode: string | null): NodeEmission;
// NodeEmission = { productCandidates: {lineId, percent?|fixedPerItem?, ruleId, message}[],
//                  orderCandidates: {...}[], deliveryCandidates: {...}[] } — 1:1 mapovatelné na výstup funkce
// explain.ts
export function explainPlan(plan: CartPlan, locale: "cs"|"en"): ExplainItem[]; // lidské věty, žádné enumy
// targeting.ts — co zapisuje sync do produktových metafieldů
export function productRuleIndex(config, productsWithCollections: {productId, variantIds, collectionIds}[]): Map<productId, ruleIds[]>;
// function-payload.ts — nahrazuje encodeFunctionConfig pro nový transport
export function buildShopFunctionConfig(config, now): { json, bytes, fits };
export function buildNodeVars(role: NodeRole, config, now): { campaignStart, campaignEnd, role, ruleId? };
```
**Pravidla (testy na hranice, červené první):** A1 (každá kombinace kategorií, remízy stabilně
`priority desc, id asc`), minimum košíku per měna, měna bez hodnoty = pravidlo mimo hru, `schedule`
(admin simulace s `now`), výprodej vyřazen, 1 produktová alokace na řádek, kód bez vítězného řádku
→ `explain` „máš výhodnější slevu“, pevná částka nikdy víc než cena řádku, objednávková sleva nikdy
víc než mezisoučet, doprava zdarma jen s hodnotou v měně, emise všech uzlů sečtené = plán
(property test na 200 náhodných košících s pevným seedem), výkon: 200 řádků × 50 pravidel < 50 ms v node.

### Task 2: Funkce na engine

Nahradit prototypové módy: input → `CartPlanInput` (adaptér v `src/adapt.js`), `planCart`,
`emitForNode` → operace výstupu (product/order/delivery). Dotaz: shop metafield (T0), `function_vars`
(role/ruleId/campaign), produktový metafield (`ruleIds`, `outlet`, `giftTierId`), `triggeringDiscountCode`,
`enteredDiscountCodes`, `dateTimeBetween`. Validace Shopify MCP. Fixtures pro každý A1 scénář +
contract test přes `shopify app function run` + **test instrukcí**: košík 200 řádků musí projít pod
limitem (výstup function-runneru `instructions`), jinak DONE_WITH_CONCERNS s číslem.
Delivery target: doprava zdarma (pravidlo `freeShipping`).

### Task 3: Sync vrstva + model uzlů

`AdminClient` rozhraní (`graphql(query, variables)`), implementace pro app session a pro skripty
(`shopify app execute`). `syncShop(shop, config)`: (1) `buildShopFunctionConfig` → metafieldsSet na
shop, (2) zajistí automatický uzel + kódový uzel na každé aktivní kódové pravidlo (create/update/
delete, redeem kódy, `appliesOncePerCustomer`, `usageLimit`, `combinesWith` všechny třídy, `discountClasses`
podle pravidla, `startsAt/endsAt` z `schedule`), (3) `function_vars` per uzel, (4) produktové metafieldy
z `productRuleIndex` (stránkování kolekcí, dávky po 25, jen změněné). Idempotentní, retry s backoff
(API-3), výsledek `{ok, steps[], errors[]}` pro Přehled. Prisma `WonNode {shop, ruleId?, role, nodeId,
codesHash, updatedAt}` + `NativeDiscountBackup` (pro T4) jednou migrací. Admin limit aktivních kódových
pravidel (C2): konstanta `MAX_ACTIVE_CODE_RULES` = podle limitu Shopify ověřeného v dokumentaci
(MCP), s rezervou; admin to vysvětlí.

### Task 4: Nativní slevy — detekce, přesun, undo

`detectNativeDiscounts(client)` (všechny `discountNodes`, stránkování; typy Basic/FreeShipping
automatické i kódové = přenositelné; BXGY a cizí app slevy = nepřenositelné s důvodem);
`planMove(native)` → Won pravidlo + co se ztratí (historie použití, „1× na zákazníka“ se resetuje);
`moveNative(shop, id)`: záloha (raw snapshot) → smazání nativní → vytvoření Won pravidla + sync;
selhání po smazání → okamžitá obnova ze zálohy (REL-3). `undoMove(backupId)`: obnova nativní ze
zálohy (`discountCodeBasicCreate` / `…AutomaticBasicCreate` / free shipping) + smazání Won pravidla.
Testy s fake klientem + živý test skriptem na dev storu (vytvoří nativní testovací slevu
`WON-TEST-NATIVE`, přesune, ověří košík, undo, ověří košík, uklidí).

### Task 5: Admin UI

Studio shell (`WonSection`/`WonBlock`, tokeny — vzor Won Toasts, zkopírovat do appky; doctrine
A7/§17) + `describeRule()` formátovače v core (§17a). Obrazovky: **Přehled v1** (co běží, stav
embedu z `settings_data` — hledá `blocks/won_discounts_embed/` bez závislosti na UUID, sync stav,
slevy mimo Won + tlačítko „Přesunout“, upozornění trh bez hodnoty), **Slevy a kódy** (seznam,
recepty: „% na vše“, „částka z objednávky“, „doprava zdarma“, „uvítací kód“; editor pravidla s
hodnotou per měna trhů, minimem, plánem, kódy; Pro: cílení segment/trh + kombinace per sleva —
amber), **Vyzkoušet košík** (produkty + trh/měna + kódy + čas → `planCart` + `explainPlan`),
**Onboarding 1–3** (cíle, nativní slevy, aktivace embedu deep linkem
`activateAppId=<client_id>/won_discounts_embed` + autodetekce). i18n cs/en. Každá obrazovka
v harnessu s fixture; screenshoty 390/1440.

### Task 6: Živé E2E — pokladna přes Bogus

Seed pravidel přes sync (skript `scripts/e2e/seed-mvp1.mjs` přes `AdminClient` s `shopify app execute`,
dry-run default, úklid): automatická sleva 10 % na `won-e2e-simple-a`, kód `WONE2E15` 15 % na objednávku.
Spec (obě témata): košík → sleva v `/cart.js`; kód přes `/cart/update.js` → `applicable: true`;
checkout: vyplnit adresu (CZ trh), karta Bogus `1`, dokončit → na děkovné stránce sleva i částka
odpovídají `planCart` (stejný vstup). Přesun nativní slevy + undo (T4 skript) jako samostatný
live krok s důkazem. Tempo požadavků kvůli Cloudflare 429 (≥ 1,5 s mezi zápisy do košíku).

### Task 7: Brána, QA, audit, commit

Společná brána + `npm test -w won-discounts-engine` + E2E bez `--bail` + vizuální QA (harness
obrazovky 390/1440 + storefront) + audit (role won-auditor) → oprava VŠECH nálezů (Ondřej
2026-09-28: chyby vždy opravit před posunem) + self-audit + roadmap (badge Alpha) + build log +
commit + push.

## Pořadí a paralelizace

1. **T0** (prototyp, krátký) ‖ **T1** (engine) — T1 nezávisí na verdiktu T0 (payload builder má
   obě varianty za jedním rozhraním).
2. Po T0: **T3** (sync) ‖ **T4** (nativní — používá fake klient, modely dostane od T3 hned na
   začátku: T3 nejdřív commitne migraci) ‖ **T5** (UI proti fixture configu a fake klientovi).
3. Po T1: **T2** (funkce na engine).
4. Po T2 + T3: **T6** (živé E2E), zapojení UI na sync (T5 dokončí napojení).
5. **T7**.
