# Won Discounts MVP 3 — Množstevní slevy + PDP blok + základ storefrontu (implementační plán)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §2 (`TierSet`), §3 bod 3, §4.2, §6,
> §7, §10 (MVP 3). Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md).
> Rozhodnutí: `rozhodnuti.md` (Free = 1 globální sada úrovní; Pro = sady per produkt/kolekce +
> počítání přes košík; PDP tabulka + živá cena; předpřipravené vzhledy bloků Free), `nova-aplikace.md`
> §6 + §8 (Horizon/Dawn: `shopify:product:select`, `input.form`), §9 (support docs).

**Goal:** Merchant nastaví množstevní slevy (Free: jedna globální sada úrovní, Pro: sady na produkty
/ kolekce a počítání přes košík). Na stránce produktu (Horizon i Dawn) se ukáže tabulka úrovní a živá
cena podle zvoleného počtu kusů. Sleva v košíku (`/cart.js` `line_level_discount_allocations`) i v
pokladně odpovídá `planCart`, včetně ochrany marže. Admin má modul Množstevní slevy s věrným náhledem
bloku a výběrem předpřipraveného vzhledu.

**Architecture:** Úrovně jsou produktové kandidáty v `planCart` (modul `tiers`) — soutěží s ostatními
produktovými slevami (A1: vyhrává výhodnější) a marže je ořízne stejně jako pravidla. Automatický uzel
je emituje. Globální sada jde v shop configu; Pro sady na produkty/kolekce se předpočítají do
produktového metafieldu jako `tierRefs` (stejný mechanismus jako cílení pravidel). Storefront čte
**app-data metafield** `$app:won_discounts/storefront_config` (sady úrovní, vzhled, texty cs/sk/en)
a produktový/variantní app-owned metafield přímo v Liquidu (ověřeno v shopify.dev: `product.metafields
["$app:won_discounts"].product.value` v theme app extension) — žádné síťové volání na kritické cestě.

**Tech Stack:** jako MVP 2 + theme app extension app block (Liquid + malý čitelný JS, bez buildu),
App Bridge deep link `addAppBlockId`, `@won/testing` runner s overlayem šablony produktu.

## Global Constraints

- Vše z plánů MVP 0–2 (jen dev store, žádný deploy, povolené cesty, `packages/core` 1 agent najednou,
  subagent necommituje, nečíst tajné soubory, nestopovat `shopify app dev`).
- A1: úroveň je produktová sleva — na řádek vyhrává výhodnější (úroveň vs. pravidlo), nesčítá se;
  Pro `combinesWith` se úrovní v MVP 3 netýká [spec]. Výprodejové a dárkové řádky úrovně nedostanou.
- Úroveň = nejvyšší `minQty` ≤ spočítaný počet. Počítání: `line` (množství řádku), `product` (součet
  řádků stejného produktu, varianty dohromady), `cart` (Pro: součet všech způsobilých řádků v rozsahu
  sady). Hodnota: `percent` nebo `amountOff` per měna **na kus** (MKT-1: měna bez hodnoty = úroveň se
  v tom trhu nenabízí, admin upozorní). Pevná částka nikdy víc než cena kusu.
- Free: právě 1 globální sada, `countAcross` `line`|`product`; Pro navíc sady s rozsahem a `cart`
  (amber, BILL-1 přes `gateConfigForPlan` — sync i storefront config dostanou jen to, co plán dovolí).
- **Ochrana marže platí i pro úrovně** (engine i PDP). PDP ukazuje hodnotu, kterou pokladna dá:
  u produktu, kde marže úroveň sníží, tabulka i živá cena ukážou sníženou hodnotu. Nákupní cena se
  nikdy nevypíše do stránky: storefront dostane jen výsledné „max. sleva %“ per varianta (samostatný
  variantní metafield `$app:won_discounts/pdp` = `{max}`; funkce ho nečte).
- Storefront: SF-1 embed ani blok nemění košík; SF-2 JS ≤ 10 kB gz celkem; vlastní markery
  `data-won-discounts-*`; rescan na `shopify:product:select` (+ `event.promise`), formulář přes
  `input.form`; texty cs/sk/en z configu s fallbackem na locales extensionu; theme check 0.
- Rozpočty funkce jako MVP 2 (běžné fixtures ≤ 70 %, nejtěžší ≤ 85 % škálovaného limitu s reálnými
  id; dotaz ≤ 30 a ≤ 3000 znaků včetně komentářů; Wasm < 256 kB; shop config ≤ 9 000 B).
- Admin: cs + en, §4c, §13 (tlačítko „Přidat tabulku na stránku produktu“ = deep link do editoru
  tématu s `addAppBlockId`), §16, §17; náhled bloku věrný tématu (C5 fallback: tokeny tématu ze
  `settings_data` + stejné CSS jako storefront).
- Support docs rostou s MVP (nova-aplikace §9) — MVP 1–2 je nedoplnily, MVP 3 dluh doplní.

---

## Mapa souborů (vlastníci úkolů)

| Oblast | Soubory | Úkol |
|---|---|---|
| Engine (core) | `packages/core/src/discounts/{plan*,tiers,targeting,function-payload,function-output,plan-gate,explain,describe,storefront-config}.ts`, `config/tiers.ts` + testy | T1 |
| Funkce | `apps/won-discounts/extensions/won-discounts-engine/**` | T2 |
| Sync + data | `apps/won-discounts/app/lib/**` (mimo native), Prisma jen když nutné | T3 |
| Storefront | `apps/won-discounts/extensions/won-discounts-storefront/**` | T4 |
| Admin UI | `apps/won-discounts/app/components/**`, `app/routes/app.*`, `app/i18n/**`, harness | T5 |
| Docs | `apps/won-discounts/docs/**`, `scripts/gen-docs.ts`, docs drift test | T6 |
| E2E | `apps/won-discounts/tests/e2e/**`, `scripts/e2e/**`, `e2e/*`, `packages/testing` (overlay šablony) | T7 |

Upřesnění vlastnictví (controller 2026-09-30, kvůli paralelnímu běhu): **T3** = `app/lib/sync/**` (+ `app/lib/jobs/**`,
`app/lib/integration/costs.server.ts` jen pro `pdp`) — zápisy do Shopify. **T5** = UI **i** serverová integrace
nových obrazovek: `app/lib/integration/{tiers,settings,appearance,themes}.server.ts` (nové), `app/lib/ui-actions.server.ts`,
`app/lib/dev-harness.server.ts`, `app/components/**`, `app/routes/app.*`, `app/i18n/**`, `tests/ui/**`,
`tests/integration/{tiers,settings,appearance}*.test.ts`. Uložení jde přes stávající `config-write.server.ts` +
`save-and-sync.server.ts` (beze změny rozhraní; sync si nové zápisy přidá sám). **T4** navíc
`tests/contracts/theme-extension.contract.test.ts` a nový `tests/contracts/storefront-tiers.contract.test.ts`.

## Kontrakty (controller, zafixované před paralelním rozjezdem)

**K1 — Která sada platí pro produkt (rozhodnutí controlleru).** Na produkt platí **právě jedna** sada úrovní:
1. první sada (v pořadí configu), jejíž `scope.productIds` obsahuje produkt; jinak
2. první sada, jejíž `scope.collectionIds` obsahuje některou kolekci produktu; jinak
3. první globální sada (`scope: "global"`); jinak žádná.

Sync ji předpočítá do produktového metafieldu jako `tierRef` (jen případy 1–2; chybí = globální sada). `tierRef`
na sadu, která v payloadu není → produkt **nemá žádnou úroveň** (fail closed, zákazník dostane méně, nikdy víc).
Free (`gateConfigForPlan`): sady s rozsahem se nemažou, ale **zneškodní** (`breaks: []`, `reason: "removed"`),
takže jejich produkty nespadnou do globální sady (ořez Pro nikdy nerozšíří slevu — závazek z `plan-gate.ts`).
Proč jedna sada: PDP ukazuje jednu tabulku, funkce vyhodnotí jednu sadu na řádek (rozpočet instrukcí), merchant
může produkt/kolekci dát nižší úrovně než globální. Mezi úrovní a pravidlem platí A1 (výhodnější vyhrává).

**K2 — Úroveň v enginu.** Počet: `line` = množství řádku; `product` = součet řádků stejného `productId`;
`cart` = součet všech řádků, jejichž platná sada je tatáž. Do počtu jdou jen řádky, které úroveň dostat můžou
(ne výprodej, ne dárek). Úroveň = nejvyšší `minQty` ≤ počet. Hodnota na kus: `percent` nebo `amountOff[měna košíku]`
(minor units; úroveň bez částky v měně košíku se v tom trhu nenabízí, celá sada jen když ji nemá žádná úroveň → stav `currency_missing`; částka max. cena kusu). Kandidát
s id `tier:<setId>`, `module: "tiers"`, `method: "automatic"`, `priority` 0; soutěží s produktovými pravidly
(výhodnější vyhrává, remíza `priority desc, id asc`), nikdy se nesčítá (Pro `combinesWith` se úrovní netýká).
Marže ořízne úroveň jako každou produktovou slevu. Emituje automatický uzel.

**K3 — Produktový metafield** `$app:won_discounts/product` (`ProductMetafieldValue`) dostane
`tierRef?: string` (id sady; jen když platí sada s rozsahem). Čte ho funkce (T2) i Liquid (T4):
`product.metafields["$app:won_discounts"].product.value.tierRef`.

**K4 — Variantní metafield** `$app:won_discounts/pdp` (typ `json`) = `{"max": <0–100, 1 desetinné místo, zaokrouhleno
dolů>}`: nejvyšší sleva v %, kterou ochrana marže u varianty dovolí při její ceně v měně obchodu. Jen varianty
se známou nákupní cenou při zapnuté marži; jinak metafield neexistuje. Funkce ho nečte. Nákupní cena se nikdy
nepíše do stránky.

**K5 — Storefront config** = app-data metafield (vlastník `AppInstallation`, namespace `won_discounts`, klíč
`storefront_config`, typ `json`; app-data **nepoužívá** `$app`), Liquid: `app.metafields.won_discounts.storefront_config.value`.
Staví ho `buildStorefrontConfig` z **gated** configu (BILL-1). Tvar v1 (typy v `@won/core/discounts/storefront-config`):

```ts
interface StorefrontConfigV1 {
  v: 1;
  cv: string;                       // verze ShopConfig, ze které vznikl (ladění, E2E)
  tiers: {
    global: string | null;          // id globální sady (K1 bod 3) nebo null
    sets: Record<string, { count: "line" | "product" | "cart"; breaks: StorefrontTierBreak[] }>;
  };
  margin: { on: false } | { on: true; max: number; col?: Record<string, number> };
  // max = strop % pro varianty bez nákupní ceny (globální); col = číselné id kolekce → platný strop % té kolekce
  // (produkt podle svých `marginRefs`, víc refů → nejnižší). Varianta s `pdp.max` bere `pdp.max`.
  appearance: { preset: AppearancePreset };
  texts: Partial<Record<"cs" | "sk" | "en", Record<string, string>>>; // jen texty změněné merchantem; fallback = locales extensionu
}
type StorefrontTierBreak = { min: number; pct: number } | { min: number; off: Record<string, number> };
// off = částka na kus v jednotkách Liquid money (hlavní jednotka × 100) per ISO měna — builder převádí z minor units podle exponentu.
```

**K6 — PDP počet a cena.** Počet na PDP = zvolené množství + kusy už v košíku, které se do téže úrovně počítají
(`line`: stejná varianta, `product`: stejný produkt, `cart`: řádky se stejnou platnou sadou; čte se z Liquid `cart`
při renderu, JS košík nenačítá). Sleva na kus = `min(pct, max)` % z ceny, resp. `min(off, cena × max / 100)`, kde
`max` = `pdp.max`, jinak strop z `margin` (K5), jinak 100.

**K7 — Vzhledy.** `APPEARANCE_PRESETS = ["default", "highlight", "chips", "tiles"]` (`config.storefront.appearancePreset`;
`default` = tabulka, `highlight` = zvýrazněná aktivní úroveň, `chips` = kompaktní štítky v řádku, `tiles` = dlaždice).
Neznámá hodnota → `default` + issue.

**K8 — DOM bloku** (stejný pro Liquid, JS i náhled v adminu; CSS jen v `assets/won-discounts-tiers.css`, třídy
`won-tiers*`, barvy a písmo se dědí z tématu přes `inherit`/`currentColor`, akcent z nastavení bloku `accent`):

```html
<div class="won-tiers won-tiers--{preset}" data-won-discounts-tiers data-state="ready|empty"
     data-set-id="…" data-count-mode="line|product|cart" data-preset="{preset}">
  <p class="won-tiers__heading">…</p>
  <ol class="won-tiers__list" role="list">
    <li class="won-tiers__row" data-won-discounts-tier-row data-min="3" data-active="true|false">
      <span class="won-tiers__qty">Od 3 ks</span><span class="won-tiers__save">−10 %</span><span class="won-tiers__unit">…/ks</span>
    </li>
  </ol>
  <p class="won-tiers__live" data-won-discounts-live-price data-unit-cents="…" aria-live="polite">…</p>
  <p class="won-tiers__next" data-won-discounts-tier-next hidden>…</p>
  <script type="application/json" data-won-discounts-tiers-data>{…}</script>
</div>
```
JS po každé změně vyšle `document` event `won-discounts:tiers:update` (`detail: {variantId, quantity, count, min, unitCents}`).

**K9 — View modely adminu** jsou v `app/components/model/types.ts` (sekce „MVP 3“, commit controlleru před rozjezdem).

---

### Task 1: Engine — úrovně v `planCart` (core, jediný zapisovatel)

**Produces:** `CartLineInput.tierRefs?: readonly string[]` (Pro sady z produktového metafieldu),
`PlanModule = "codes" | "tiers"`, kandidát úrovně s id `tier:<setId>`, `RuleOutcome` pro sady
(stavy jako pravidla + `below_tier` = žádná úroveň nedosažena), `describeTierSet` / explain cs+en
(„Od 3 ks −10 %“, „Přidej 1 ks a dostaneš −15 %“ jako `progress.tierHint` pro MVP 4),
`buildStorefrontConfig(config, plan, { locales })` → JSON pro app-data metafield (sady, vzhled,
texty; bez citlivých dat), payload úrovní v shop configu (kompaktně), `tierRefs` v
`productRuleIndex` (rozpočet produktového metafieldu jako refy pravidel).
Kontrakty K1–K7 platí doslova. `pdpMaxDiscountPercent({ unitPrice /* minor, shop currency */, unitCost, costCurrency,
shopCurrency, margin /* gated MarginModule */, collectionIds })` → `number | null` (null = marže vypnutá / bez nákupní
ceny); `buildStorefrontConfig(gatedConfig, { configVersion, exponentOf })` → `StorefrontConfigV1`; sanitizer: úroveň má
právě jednu hodnotu (`percent` i `amountOff` → zůstane `percent` + issue; žádná → úroveň zahozena + issue), `minQty`
rostoucí a unikátní (duplicitní zahozené + issue), `appearancePreset` z `APPEARANCE_PRESETS`.
**Pravidla (testy červené první):** výběr úrovně a hranice minQty (2/3/4 ks), tři režimy počítání
(varianty stejného produktu, košík jen v rozsahu sady), měna bez hodnoty, amountOff > cena kusu,
úroveň vs. pravidlo (výhodnější vyhrává, remíza stabilně), výprodej/dárek bez úrovně, marže ořízne
úroveň, Free gating (víc sad / rozsah / `cart` → poznámka `explainGate`, Free dostane první globální),
kampaň se úrovní netýká [spec, přepisy kampaní v MVP 6], emise = plán (property test), výkon.

### Task 2: Funkce (Rust) — úrovně + shoda

Dotaz: `product { id }` k variantě (počítání `product`) a `tierRefs` z produktového metafieldu
(už čtený); hlavičky + `query-cost.test.js` (26 → 27, 27 → 28). Port 1:1, fixtures (každé pravidlo
T1), náhodná shoda s úrovněmi (všechny režimy, měny, marže), TS dvojčata, rozpočtové fixtures s
úrovněmi na každém řádku (reálná id) pod branami MVP 2.

### Task 3: Sync — storefront config, `tierRefs`, PDP max. sleva

- Zápis app-data metafieldu `$app:won_discounts/storefront_config` (owner = AppInstallation;
  `metafieldsSet`, gated config, verze + zpětné čtení) v pořadí syncu po shop configu.
- `targetScopes` + produktové metafieldy s `tierRefs` (Pro sady s rozsahem); BEFORE/AFTER lane jako
  refy pravidel (přidání = sleva navíc → AFTER lane je bezpečná).
- Variantní metafield `pdp = {max}`: zrcadlo nákupních cen ho při zapnuté marži zapisuje u variant s
  nákupní cenou (max. sleva % z hranice marže při ceně v měně obchodu, zaokrouhleno dolů na 0,1 %);
  přepočet při změně ceny/nákupní ceny/nastavení marže; při vypnuté marži se smaže. Bez nákupní ceny
  PDP bere strop z configu (+ kolekce přes `marginRefs`).
- Data pro admin: stav storefront configu, počet produktů s Pro sadou, „tabulka je/není na stránce
  produktu“ (read_themes: blok `quantity_tiers` v `templates/product*.json` aktivního tématu).

### Task 4: Storefront — blok `quantity_tiers` + vzhledy

- App block `blocks/quantity_tiers.liquid` (target section, jen šablona produktu): tabulka úrovní pro
  aktuální variantu (Liquid spočítá z configu + `tierRefs` + marže max), JSON dat všech variant pro
  JS, markery `data-won-discounts-tiers`, `data-won-discounts-tier-row`, `data-won-discounts-live-price`.
- `assets/won-discounts-tiers.js` (čitelný, bez buildu): živá cena a zvýraznění úrovně podle
  množství ve formuláři (`input.form`, `input`/`change`), rescan na `shopify:product:select`
  (`event.promise`), formát ceny podle `Shopify.currency`/money formátu tématu; nikdy nemění košík.
- 4 předpřipravené vzhledy (CSS proměnné, `storefront.appearancePreset`), barvy/fonty dědí z tématu.
- Locales cs/sk/en v extensionu jako fallback textů; theme check 0; rozpočet JS ≤ 10 kB gz celkem.
- **Živé fakty (T7 je sbírá):** F-T1 Liquid čte `$app` produktový/variantní metafield v bloku na
  Horizon i Dawn; F-T2 `app.metafields` čte storefront config; F-T3 typ bloku v šabloně =
  `shopify://apps/won-discounts/blocks/quantity_tiers/<registrační UUID extensionu>`.

### Task 5: Admin — modul Množstevní slevy + Vzhled

- Route `app.tiers.tsx` (vyhraje nad `app.$module`), `TiersScreen`: globální sada (úrovně: od X ks,
  % nebo částka per měna trhů), počítání (řádek / produkt), Pro (amber): další sady s rozsahem
  (resource picker produktů/kolekcí) a počítání přes košík; poctivé věty (co se sčítá s čím, že marže
  úroveň sníží); stav „tabulka na stránce produktu“ + tlačítko s deep linkem `addAppBlockId`.
- Věrný náhled bloku: tokeny aktivního tématu ze `settings_data` (read_themes), stejné CSS jako
  storefront, vzhledy přepínatelné v náhledu; „Zobrazit na mém webu“ → produkt se sadou.
- Vzhled: minimální obrazovka nebo sekce s výběrem ze 4 vzhledů (Pro vlastní vzhled = MVP 7).
- **Dluh MVP 1:** Free přepínače kombinování po kategoriích (rozhodnutí A1: výprodej s ničím,
  produkt vs. objednávka, produkt/objednávka vs. doprava) v Nastavení — engine je umí
  (`engine.combination`), admin je zatím nemá; jedno tlačítko uložení, poctivé vysvětlení, co přepnutí
  udělá, a náhled ve Vyzkoušet košík.
- Přehled (karta Množstevní slevy), Vyzkoušet košík (úrovně ve vysvětlení), editor pravidla (když
  pravidlo soutěží s úrovní), harness + screenshoty 390/1440, i18n cs/en.

### Task 6: Support docs — dluh MVP 1–3

`apps/won-discounts/docs/`: `concepts/` (jak Won počítá slevy, kombinování A1, kódy a přesun
nativních slev, ochrana marže, množstevní slevy), `tasks/` pro stabilní featury, `support/` FAQ
(„proč se sleva v pokladně liší“, „kód se neuplatnil“, „sleva je nižší kvůli marži“); `scripts/
gen-docs.ts` + `docs:gen` + `reference/*.generated.md` z exportovaných enumů/limitů core;
`tests/docs-freshness.test.ts` v `test:unit` (vzor `apps/won-toasts/docs/`); frontmatter pro RAG.

### Task 7: Živé E2E — PDP tabulka + košík + pokladna (Horizon + Dawn, bez `--bail`)

- `@won/testing`: overlay šablony (`templateOverlays` vedle `settingsDataOverlay`, generické, bez
  dopadu na Toasts) → blok `quantity_tiers` v hlavní sekci produktu obou témat; generátor + `--check`.
- Seed profil `tiers`: globální sada `od 3 ks −10 %`, `od 5 ks −15 %` (Free), marže zapnutá s
  produktem, kde úroveň ořízne (won-e2e-simple-a má nákupní cenu). Spec: tabulka se zobrazí a živá
  cena reaguje na počet (obě témata, variant switch na two-variants), 3 ks → `/cart.js`
  `line_level_discount_allocations` = plán, pokladna Bogus = `planCart`, oříznutá úroveň na PDP =
  oříznutá v košíku; fáze Pro: sada na kolekci + `cart` počítání. Úklid + verify-clean.
- Evidence `docs/won-discounts/evidence/mvp3/`, fakta F-T1–F-T3.

### Task 8: Brána, QA, audit, commit

Společná brána + E2E obě témata bez `--bail` + vizuální QA (storefront PDP 390/1440 obě témata,
admin harness, **náhled v adminu vs. živý storefront** — věrnost náhledu) + audit (hlavní + drift) →
oprava všech nálezů + self-audit + roadmap (MVP 3 hotovo, badge Beta) + build log + commit + push.

## Pořadí a paralelizace

T1 má dvě fáze jednoho agenta: **T1a** (kontraktní povrch: sanitizer úrovní a vzhledů, `gateConfigForPlan` K1,
`tierRef` v `productRuleIndex`, kompaktní úrovně v payloadu, `buildStorefrontConfig`, `pdpMaxDiscountPercent`,
`describeTierSet`) → commit → **T1b** (úrovně v `planCart`, explain, emise, výkon).

1. Kontrakty K1–K9 (controller) → vlna A: **T1a** ‖ **T4** ‖ **T5** ‖ **T6** ‖ **T7a** (overlay v `packages/testing`).
2. Po T1a: **T1b** ‖ **T3**. Po T1b: **T2**.
3. Task review běží souběžně s další prací; po T2–T5: **T7** živé E2E. 4. **T8** (audit hlavní + drift najednou,
   opravy v 2–3 paralelních balících, re-review jednou dávkou).
