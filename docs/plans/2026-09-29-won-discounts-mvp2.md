# Won Discounts MVP 2 — Ochrana marže (implementační plán)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §1 (co kde žije), §3 bod 7,
> §4.5, §7, §10 (MVP 2). Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md).
> Rozhodnutí: `rozhodnuti.md` (Free = globální minimum, Pro = per kolekce + přehled zásahů),
> `mezery.md` A2 (bez nákupní ceny → max. sleva %, sleva se sníží, nikdy neblokuje).

**Goal:** Žádná kombinace Won slev nesníží cenu řádku pod nastavené minimum: produktová sleva se
ořízne na hranici, objednávková sleva se sníží nebo vynechá řádky na hranici, checkout se nikdy
neblokuje. Free: globální minimum marže z nákupní ceny + strop % pro produkty bez nákupní ceny.
Pro: nastavení per kolekce + přehled zásahů. Admin ukáže, kolik produktů nemá nákupní cenu.

**Architecture:** Marže je poslední krok `planCart` (TS reference v `@won/core/discounts`, Rust
port ve funkci, shoda přes fixtures + náhodnou shodu). Funkce nemá nákupní cenu ve vstupu, proto
sync zrcadlí `inventoryItem.unitCost` do app-owned **variant metafieldu** `$app:won_discounts/variant`
(jen varianty s cenou > 0) a převádí ji do měny košíku kurzem `presentmentCurrencyRate` z vstupu
funkce. Per-kolekce nastavení (Pro) jde do produktového metafieldu jako `marginRefs` (stejný
mechanismus jako cílení MVP 1). Zrcadlo drží čerstvé webhooky `inventory_items/update`
(stačí `read_products`, changelog 2025-03-31) + `products/create|update` + denní srovnání.

**Tech Stack:** jako MVP 1 (TS core `node:test`, Rust `shopify_function` 2.x, React Router 7 +
Polaris web components, Prisma SQLite, Playwright checkout přes Bogus, `shopify app execute`).

## Global Constraints

- Vše z plánů MVP 0/1: jen dev store, žádný deploy, sahat jen na `apps/won-discounts/**`,
  `packages/**`, `docs/**`, `tests/**`; `packages/core` mění 1 subagent najednou; subagent
  **necommituje** (commituje controller jen soubory z reportu); nečíst `shpat.md`, `.env*`,
  `.auth/`, `prisma/dev.sqlite`; nestopovat `shopify app dev`.
- Kombinování A1 beze změny; na řádek nejvýš 1 produktová alokace; hodnotu kódu vydává jen jeho uzel.
- **Marže nikdy neblokuje, jen snižuje** (princip 5). Dárkové řádky ignoruje, výprodejové řádky
  nemají slevu vůbec, doprava se marže netýká. Platí i v kampaních (přepisy kampaně před marží).
- **Definice marže [spec, rozhodnutí běhu 2026-09-29]:** stejně jako Shopify u produktu:
  `marže = (cena po slevách − nákupní cena) / cena po slevách`. Minimální cena kusu s nákupní
  cenou: `floorUnit = ceilTol(costMinor / (1 − m/100))`, `m = minMarginPercent ∈ [0, 95]`
  (nezadané = 0 → nikdy pod nákupní cenu). Bez nákupní ceny (chybí, ≤ 0, jiná měna než obchod):
  `floorUnit = ceilTol(unitPrice × (1 − p/100))`, `p = maxDiscountPercent ∈ [0, 100]`, výchozí 50.
  `ceilTol(x) = ceil(x − 1e-6)` (minor units), stejně v TS i Rustu.
- `costMinor = unitCost × shopToCartRate × 10^exp(měna košíku)`; `unitCost` v hlavních jednotkách
  měny obchodu, kurz = `presentmentCurrencyRate` (měna obchodu → měna košíku). Chybí/nevalidní
  kurz a měna košíku ≠ měna obchodu → nákupní cena se bere jako neznámá (platí strop %).
- Ochrana je **vypnutá ve výchozím stavu** (`modules.margin.enabled = false`, chování MVP 1 se
  nemění); zapíná ji merchant v modulu Ochrana marže.
- Per kolekce (Pro): produkt ve víc kolekcích s nastavením → nejpřísnější hodnota (max `m`, min `p`),
  nezadané pole kolekce → globální hodnota. Free: `gateConfigForPlan` už kolekce skládá do globálu.
- Objednávková sleva: rozpočet na řádky Shopify nezveřejňuje → engine je konzervativní pro oba
  proporcionální základy (cena řádku po produktových slevách i před nimi) a nechává 1 minor unit
  rezervu na zaokrouhlení na každém řádku.
- Rozpočty: shop config ≤ 9 000 B (margin v kompaktním tvaru), produktový metafield ≤ 9 000 B,
  dotaz funkce ≤ 30 (lines 22 → 26, delivery 23 → 27), 200 řádků ≤ 7,7 M instrukcí, výstup ≤ 20 kB,
  Wasm < 256 kB.
- **Přehled zásahů (Pro) [spec]:** počítá se z configu a zrcadla (kde marže aktivní slevy sníží
  a o kolik), ne z objednávek — objednávky vyžadují `read_orders` (chráněná zákaznická data);
  počty skutečných zásahů z objednávek přijdou s analytikou v MVP 7 (spec §1 `MarginIntervention`).
- Admin: cs + en, žádné raw enumy (§4c), každá otázka = jedno tlačítko (§13), Pro prvky amber a
  viditelné (§16), BILL-1 na serveru, poctivá copy (marže z ceny, kterou platí zákazník — u cen
  s DPH včetně DPH; zrcadlo nákupních cen se obnovuje webhooky a denně).

---

## Mapa souborů (vlastníci úkolů)

| Oblast | Soubory | Úkol |
|---|---|---|
| Engine (core) | `packages/core/src/discounts/{config/*,cart,plan,margin,emit,explain,describe,targeting,function-payload,function-output,plan-gate}.ts` + `packages/core/tests/discounts/**` | T1 |
| Funkce | `apps/won-discounts/extensions/won-discounts-engine/**` | T2 |
| Sync + data | `apps/won-discounts/app/lib/**` (mimo `native/**`), `prisma/**` (1 migrace), `shopify.app.toml`, `app/routes/webhooks.*` | T3 |
| Admin UI | `apps/won-discounts/app/components/**`, `app/routes/app.*`, `app/i18n/**`, harness fixture | T4 |
| E2E data | `packages/testing/src/e2e-products.{js,d.ts}`, `packages/testing/scripts/seed-e2e-products.mjs` | T5a |
| Živé E2E | `apps/won-discounts/tests/e2e/**`, `apps/won-discounts/scripts/e2e/**`, evidence | T5b |

---

### Task 1: Engine — ochrana marže v `planCart` (core, jediný zapisovatel `packages/core`)

**Produces (rozhraní pro T2–T5):**
```ts
// config/types.ts
interface MarginModule { enabled: boolean /* default false */;
  global: { minMarginPercent?: number /* 0–95 */; maxDiscountPercent: number /* 0–100, default 50 */ };
  perCollection: MarginCollectionOverride[] /* Pro */ }
// cart.ts
interface CartLineInput { …; unitCost?: number /* shop currency, major units, > 0 */;
  marginRefs?: readonly string[] /* numeric ids of margin-override collections */ }
interface CartPlanInput { …; shopToCartRate?: number /* presentmentCurrencyRate */; shopCurrency?: string }
// function-payload.ts — kompaktní margin v shop configu (rozpočet 9 000 B)
type FunctionMarginPayload = { enabled: false } | { enabled: true; min?: number; max: number;
  cur: string /* shop currency */; col?: Record<string /* numeric collection id */, [number | null, number | null]> };
// targeting.ts — produktový metafield
interface ProductMetafieldValue { ruleIds: string[]; variantRuleIds: Record<string, string[]>; marginRefs?: string[] }
// margin.ts (nový) — sdílí plan.ts i admin
export function resolveMargin(payload: FunctionMarginPayload, marginRefs: readonly string[]):
  { minMarginPercent: number; maxDiscountPercent: number; source: "global" | "collection" } | null;
export function marginFloorUnit(args: { unitPrice: number; costMinor: number | null;
  minMarginPercent: number; maxDiscountPercent: number }): { floorUnit: number; basis: "cost" | "max_percent" };
export function costMinorUnits(unitCost: number | undefined, rate: number | undefined, cartCurrency: string,
  shopCurrency: string | undefined): number | null;
export function marginImpact(config /* gated */, variants: MarginVariant[], currency: string): MarginImpact;
// MarginVariant = { productId, variantId, title, price /* minor, shop currency */, cost: number | null,
//   ruleRefs: string[], marginRefs: string[] }; MarginImpact = { rules: { ruleId, variants: number,
//   capped: { variantId, wanted, allowed, basis }[] /* top 50 by lost amount */ }[], withoutCost: number }
// plan.ts
interface PlanLine { …; marginCapped?: { before: number; after: number; floorUnit: number;
  basis: "cost" | "max_percent"; minMarginPercent?: number; maxDiscountPercent?: number; source: "global" | "collection" } }
interface PlanOrder { …; marginExcludedLineIds: string[]; marginCapped?: { before: number; after: number } }
type RuleState = … | "margin_floor"; // měl co dát, ale všude ho marže srazila na 0
```

**Pravidla (testy červené první, `node:test`):**
- Sanitizer: `enabled` bool (výchozí false, starý config bez klíče = false), `minMarginPercent`
  clamp 0–95 s `issue`, per-kolekce stejně; fixture configu bez `enabled` se čte beze změny chování.
- `marginFloorUnit` hranice: m = 0 (= nákupní cena), m = 95, p = 0 (žádná sleva), p = 100 (bez
  omezení), `ceilTol` na x.000001 / x.999999, měny s exponentem 0 (JPY, HUF) a 3 (KWD).
- `costMinorUnits`: chybí kurz a měny se liší → null; měny stejné → kurz 1; `cur` ≠ měna obchodu → null.
- **Produktová fáze:** po `planProducts` pro každý řádek s alokací `headroom = max(0, subtotal −
  floorUnit × quantity)`; alokace > headroom → ořez na headroom, komponenty Pro stacku se
  přerozdělí v pořadí ranku, vlastník se přepočte (`ownerOf` nad zbylými), hodnota
  `{fixedTotal}`; headroom 0 → řádek bez produktové slevy. `marginCapped` s důvodem.
  Pravidlo, které mělo kandidáty a všude skončilo na 0 → `margin_floor`.
- **Objednávková fáze:** `a_i` = řádek po produktové slevě, `s_i` = před ní, `h_i = max(0,
  a_i − floorUnit_i × q_i − 1)`. Pro množinu řádků I: `S_I = Σa_i`, `S0_I = Σs_i`,
  `D_max(I) = min_{i∈I} min(h_i × S_I / a_i, h_i × S0_I / s_i)` (zaokrouhleno dolů). Kandidátní
  množiny = prahy podle poměru `h_i / a_i` (řádky nad prahem), chtěná sleva se pro každou I
  přepočítá (`orderAmount` nad `S_I`, Pro stack stejné složení), výsledek `min(chtěná, D_max)`;
  vyhrává největší sleva, remíza → víc řádků. Vynechané řádky → `marginExcludedLineIds` (jdou do
  `excludedCartLineIds`). Neořezaná sleva s vynecháním zůstává procentem, ořezaná `{fixedTotal}`.
  Totéž ve výlučném režimu (`productWithOrder = false`) pro scénář „jen objednávka“.
- Marže vypnutá → plán bit po bitu jako MVP 1 (všechny stávající testy beze změny zelené).
- Kampaň: přepisy pravidel před marží, marže platí dál.
- `function-output.ts`: uvolňování nad rozpočtem výstupu nikdy nepřevede ořezanou hodnotu na
  procento (jen zahodit smí); test.
- `emit`: součet emisí všech uzlů = plán i s marží (property test, 200 košíků, pevný seed);
  invariant v property testu: žádný řádek po všech slevách pod `floorUnit × q` (oba základy rozpočtu).
- `explain` / `describe` cs + en: řádek ořezaný (z → na, proč: nákupní cena + min. marže / strop %
  bez nákupní ceny, kolekce), objednávková sleva snížená / nevztahuje se na řádky X, stav
  `margin_floor`. Žádné enumy v textu.
- `targeting.ts`: `marginRefs` = číselná id kolekcí s nastavením marže, ve kterých produkt je;
  přes rozpočet se **nikdy** nezahazují `marginRefs` (zahazují se nejdřív refy pravidel = méně
  slevy, fail closed).
- `function-payload.ts`: kompaktní margin (`col` tuple), nejhorší případ 100 kolekcí se vejde do
  rozpočtu s ostatním obsahem testu rozpočtu; `shopCurrency` je vstup builderu.
- `marginImpact`: pro aktivní produktová pravidla a varianty v jejich cílení spočítá 1 ks v měně
  obchodu, kde marže slevu sníží; objednávková pravidla → počet variant, kde by % podlezlo.
- Výkon: 200 řádků × 50 pravidel s marží a objednávkovou slevou < 50 ms v node.

### Task 2: Funkce (Rust) — marže + vstup + shoda

- Dotaz (oba targety): `presentmentCurrencyRate` + na `ProductVariant`
  `wonVariant: metafield(namespace: "$app:won_discounts", key: "variant") { jsonValue }`; hlavičky
  a `query-cost.test.js` → lines 26, delivery 27. Validace Shopify dev MCP (`validate`).
- `input.rs`: `unitCost` + `cur` z variant metafieldu (junk → neznámá), `marginRefs` z produktového
  metafieldu, kurz jako f64; `engine/plan.rs` + `engine/margin.rs`: port T1 1:1 (stejné pořadí
  float operací, `ceilTol`), `output.rs`: ořezané hodnoty neuvolňovat na procento.
- `tests/reference-adapter.js` + `generate-fixtures.js`: fixtures pro každé pravidlo T1 (ořez
  produktu, stack Pro, vynechané řádky, ořez objednávky, výlučný režim, bez nákupní ceny, cizí
  měna s kurzem, kurz chybí, kolekce nejpřísnější, marže vypnutá, kampaň + marže, delivery target
  s řádkem ořezaným na 0 → shodné rozhodnutí o dopravě). Náhodná shoda: náklady, kurzy, exponenty
  0/2/3, přepínač marže, override kolekce; počty zásahů per větev marže > 0. TS dvojčata nových
  Rust unit testů. Instrukce: 200 řádků s marží + objednávkou ≤ 7,7 M; Wasm < 256 kB.
- **Živé fakty (po buildu v běžícím `shopify app dev`):** F-M1 směr a hodnota
  `presentmentCurrencyRate` v CZK košíku (log funkce v `.shopify/logs`), F-M2 funkce čte variant
  metafield zapsaný appkou. Důkaz → `docs/won-discounts/evidence/mvp2/f-m*.json`.

### Task 3: Sync — zrcadlo nákupních cen, `marginRefs`, webhooky, data pro admin

- Prisma (1 migrace): `VariantCost { shop, variantId, productId, inventoryItemId, price String,
  cost String?, currency String?, metafieldValue String?, updatedAt }` (`@@unique([shop, variantId])`,
  `@@index([shop, inventoryItemId])`) + `ShopSyncState`: `costsScannedAt`, `costsCursor`,
  `costsPending` (počty pro Přehled). Odinstalace maže `VariantCost` jako `ProductTargetIndex`,
  `shop/redact` taky.
- `app/lib/sync/costs.ts`: úplný průchod `productVariants(first: 250)` (id, price, product.id,
  inventoryItem { id unitCost { amount currencyCode } }, variant metafield) → rozdíl proti
  požadované hodnotě → `metafieldsSet` po 25 (ownerId varianta, type json, `{"cost": n, "cur": "USD"}`)
  a `metafieldsDelete` tam, kde cena zmizela; jen změněné; zrušitelný (novější běh ruší starší),
  pokračuje z kurzoru, retry/backoff (API-3); běží jen když je marže zapnutá (gated config).
  Pořadí vůči shop configu: config se zapíše hned (neznámá cena = strop %, což je přísnější než
  vypnutá ochrana); admin ukazuje „propisujeme nákupní ceny N z M“.
- Spouštěče: zapnutí marže (uložení) → průchod na pozadí; webhook `inventory_items/update`
  (`/webhooks/costs`, include_fields `id, cost, updated_at, admin_graphql_api_id`) → dohledat
  variantu (`inventoryItem(id).variant`) → přepsat jeden metafield (debounce po shopu);
  `products/create` (nový topic, i pro cílení MVP 1) a `products/update` → varianty produktu;
  srovnání, když poslední úplný průchod > 24 h (Přehled + periodická úloha vzor `jobs/stale-claims`).
  **Živý fakt F-M3:** změna nákupní ceny přes `productVariantsBulkUpdate` vyvolá
  `inventory_items/update` s `read_products` (log `app dev`) — důkaz do evidence.
- `marginRefs`: `targetScopes` zahrne kolekce s nastavením marže (jen zapnutá marže, gated config),
  produktový metafield dostane `marginRefs` (core `productRuleIndex`), `ProductTargetIndex` nese i je.
- `buildShopFunctionConfig` dostane `shopCurrency` z kroku 0 (čtení shopu).
- `app/lib/integration/margin.server.ts`: `loadMargin(shop)` → `{ margin config, gate notes,
  mirror status { variants, withCost, withoutCost, productsWithoutCost, scannedAt, inProgress,
  lastError }, withoutCostSample (20 produktů), impact (jen Pro, `marginImpact`) }`;
  akce `refreshCosts(shop)`. Nastavení se ukládá stávající cestou (`saveConfig` s verzí).
- Testy: fake transport (stránkování, rozdíl, mazání, zrušení, kurzor, chyby), webhooky (HMAC,
  2xx rychle, idempotence WBH-2), gating Free (bez `marginRefs`), odinstalace.

### Task 4: Admin UI — modul Ochrana marže + napojení

- Route `app.margin.tsx` (statická, vyhraje nad `app.$module`), `MarginScreen.tsx`, `margin`
  pryč z `UPCOMING_MODULES`. Obsah: přepínač „Zapnout ochranu marže“; „Minimální marže“ %
  s větou, jak se počítá (jako Shopify u produktu, z ceny, kterou platí zákazník — u cen s DPH
  včetně DPH); „Produkty bez nákupní ceny: sleva nejvýš“ %; blok „N produktů nemá nákupní cenu“
  + ukázka + tlačítko „Obnovit nákupní ceny“ + stav zrcadla; Pro (amber, ProFrame): nastavení per
  kolekce (resource picker kolekcí, min. marže / strop %) a **Přehled zásahů** (pravidlo → produkt:
  chtěná vs. povolená sleva, proč). Free vidí Pro sekce s náhledem, BILL-1 na serveru.
- Přehled: karta Ochrana marže (stav, min. marže, bez nákupní ceny, zrcadlo pozadu → tlačítko).
- Editor pravidla: když je marže zapnutá a pravidlo ji někde podleze → poznámka „Na N produktech
  se sleva sníží na hranici marže“ s odkazem na přehled zásahů.
- Vyzkoušet košík: nákupní ceny z `VariantCost`, kurz odhadnutý z cen trhu (medián contextual /
  base) s poctivým upozorněním „kurz je odhad, pokladna použije aktuální kurz Shopify“ mimo měnu
  obchodu; vysvětlení ořezů z `explain`.
- Harness `/dev/preview/margin` (Free, Pro, zrcadlo běží, 0 bez ceny) + Přehled + editor + Try
  Cart s ořezem; i18n cs/en; screenshoty 390/1440 → `scratchpad/mvp2-ui/`.

### Task 5a: E2E data — nákupní ceny ve sdíleném katalogu (paralelně s T1)

- `WON_E2E_PRODUCTS`: `cost` na variantách — simpleA 6.00, twoVariants Small 5.00 (Large bez),
  multiAxis 8.00 na všech; simpleB a spare bez nákupní ceny (cesta A2). Typy v `.d.ts`.
- `seed-e2e-products.mjs`: zapíše `inventoryItem.cost` idempotentně (beze změny = bez mutace,
  cena, která v katalogu není, se nemaže); nový exekutor `--via-app <appDir>` (`shopify app
  execute` jménem appky, bez admin tokenu) vedle stávajícího tokenu; `--dry-run` vypíše plán.
  Jiné appky se nerozbijí (katalog jen přibírá pole). Spustit: dry-run → výpis → živě.

### Task 5b: Živé E2E — pokladna s marží (Horizon + Dawn, bez `--bail`)

- `scripts/e2e/margin-fixture.mjs` + profil `margin` v seedu: marže zapnutá, m = 25 %, p = 30 %;
  automatická 50 % na simple-a + simple-b; kód `WONE2EM20` 20 % na objednávku. Košík CZ: simple-a,
  simple-b, two-variants Small, kód → simple-a ořez na floor (nákupní cena), simple-b na 30 %,
  objednávková sleva vynechá řádky na hranici a platí na Small.
- Spec: pokladna projde (nikdy neblokuje), děkovná stránka = `planCart` se skutečným kurzem z logu
  funkce, invariant: žádný řádek pod floor; `/cart.js` produktové alokace = plán.
- Fáze B (Pro, `WON_DEV_PLAN=pro`, restart `app dev`): override kolekce (testovací kolekce
  `won-e2e-margin` přes skript s dry-run a úklidem) přísnější než globál → ořez podle kolekce.
- Před fází A restart `shopify app dev` **bez** `WON_DEV_PLAN` (dev store je Free).

### Task 6: Brána, QA, audit, commit

Společná brána + `npm test -w won-discounts-engine` + E2E obě témata bez `--bail` + vizuální QA
(harness 390/1440 + storefront) + audit (role won-auditor, `.claude/agents/won-auditor.md`) →
oprava **všech** nálezů + self-audit + roadmap (MVP 2 hotovo, badge Alpha) + build log + spec
(§1, §3.7, §4.5) + commit + push.

## Pořadí a paralelizace

1. **T1** (core) ‖ **T5a** (sdílený katalog) — disjunktní soubory.
2. Po T1: **T2** (funkce) ‖ **T3** (sync) ‖ **T4** (UI proti fixture datům a rozhraní
   `loadMargin` z T3; napojení na skutečný loader po T3).
3. Po T2 + T3 (+ T5a): **T5b** živé E2E.
4. **T6**.
