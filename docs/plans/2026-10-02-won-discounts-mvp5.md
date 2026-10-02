# Won Discounts MVP 5 — Výprodej (Pro) (implementační plán, inline)

> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §0, §2 (`OutletModule`), §4.4, §6 (`outlet-badge`),
> §7 (Výprodej = celý modul Pro, A6 downgrade), §8 (výprodejové řádky), §9, §10 (MVP 5). Rozhodnutí: `rozhodnuti.md`
> „Výprodej (Outlet)“, „Výprodej per trh“, „Výprodej na webu je volba merchanta“, „Kombinování slev“ (výprodej s ničím).
> Mezery A5, A6, A7, D3. Dluh: scheduler (srovnání nákupních cen, úklid historie). Stav:
> [`../won-discounts-build-log.md`](../won-discounts-build-log.md). Práce **inline bez subagentů**.

**Goal:** Merchant (Pro) založí výprodej na existující variantě: kvóta kusů, sleva v %, volitelně konec, ceníky trhů
s pevnou cenou. Appka zálohuje původní ceny, nastaví výprodejovou `price` (+ `compare_at_price` podle zobrazení)
a pevné ceny vybraných ceníků, označí variantu jako výprodejovou (funkce ji vyřadí z ostatních slev, A1), počítá
prodané kusy z objednávek, storna a vratky se skladem vrací do kvóty, a po vyčerpání kvóty / datu / ručním konci
vrátí ceny. Každý krok jde do historie. Web ukáže výprodej podle volby (tichý / přeškrtnutá cena / + štítek /
+ „zbývá X ks“).

**Architecture:** Výprodej žije v DB appky (`OutletRun` + `OutletEvent`), ne v configu (config nese jen nastavení
modulu `display`, `reopenOnReturnAfterEnd`). Logika (výpočet cen, účetnictví kvóty, přechody stavů, rozhodnutí
při vratce po konci) je čistá v `@won/core/discounts/outlet.ts`; appka ji volá z adminu, webhooků a scheduleru.
Funkce dostane jedno pole navíc: variantní metafield `outlet` = `true` (O6, rozhodnuto měřením B0 — produktové
seznamy z MVP 1 by na zkonstruovaných tvarech přesáhly limit instrukcí). Zápisy cen: `productVariantsBulkUpdate` a `priceListFixedPricesUpdate`.

## Global Constraints

- Vše z plánů MVP 0–4 (jen dev store, žádný deploy, povolené cesty, tajné soubory nečíst, dry-run + záloha při mých
  zápisech, žádný prettier).
- **Funkce:** jen čtení variantního příznaku `wonOutlet` (O6): TS + Rust + fixtures + parita + replay + rozpočet na
  rodinách cap 550; dotaz ≤ 3 000 znaků a ≤ 30 bodů, Wasm < 256 000 B.
- **BILL-1 / A6:** nový výprodej jen s Pro (`planOf(shop) === "pro"`, server). Ve Free: založení / znovuotevření /
  prodloužení odmítnuto; běžící výprodej **doběhne** (kvóta / datum / ruční konec vrátí ceny). Příznak `outlet` se
  nikdy neodebere kvůli tarifu (odebrání by slevu rozšířilo — fail closed).
- **Záloha před každým zápisem ceny** (§14c): původní `price`, `compareAtPrice` varianty a pevné ceny vybraných
  ceníků se uloží do `OutletRun.backup` **před** prvním zápisem (write-ahead); bez zálohy se nezapisuje.
- **Pořadí zápisů:** start = příznak `outlet` → ceny; konec = ceny → příznak pryč. Mezi kroky nikdy výprodejová cena
  bez příznaku (jinak by výprodej dostal další slevy).
- **Idempotence (WBH-2):** každý webhook krok má unikátní klíč v `OutletEvent`; opakované doručení nic nezmění.
- **Nikdy nepřepsat cizí změnu ceny:** při vracení se vrací jen pole, které má pořád naši výprodejovou hodnotu;
  jinak historie „cena změněna mimo appku, nevráceno“ a admin to řekne.
- **SF-2:** všechno storefront JS ≤ 10 240 B gz dohromady, každý soubor ≤ 10 000 B raw; nejdřív uvolnit místo.
- **Stránka produktu nikdy neslíbí víc, než dá pokladna:** výprodejová varianta nemá množstevní tabulku ani živou
  cenu úrovní (pokud `outletWithAnything` není zapnuté).
- Scheduler: jedna instance (Fly single machine, jako dnešní joby), injektované hodiny v testech.

---

## Kontrakty (zafixované před implementací)

**O1 — Model běhu (Prisma).**
`OutletRun { id, shop, productId (GID), variantId (GID), quota Int, percent Int (1–90), endsAt DateTime?,
priceListIds Json (string[] vybraných ceníků), status: "starting" | "active" | "ending" | "ended", endReason:
"quota" | "date" | "manual" | null, sold Int, returned Int, backup Json?, sale Json?, returnPending Int (kusy vrácené
po konci, čekají na rozhodnutí), createdAt, startedAt?, endedAt?, updatedAt, error String? }` — index `(shop, status)`,
nejvýš **1 neukončený běh na variantu** (kontrola v transakci) a **nejvýš N produktů s neukončeným během na shop**
(`OUTLET_LIMITS.products`, N z měření rozpočtu níž; strop drží admin i sync).
`OutletEvent { id, shop, runId, kind, qty Int, orderId String? (číselné id objednávky, žádná PII), key String
@unique per shop, at, detail Json? }` — `kind`: `started`, `sale`, `cancel`, `refund`, `quota_reached`, `ended`,
`price_restored`, `price_kept` (cizí změna), `price_list_skipped`, `return_after_end`, `reopened`, `oversold`,
`start_failed`, `end_failed`. Klíč: `sale:<orderId>:<lineItemId>`, `cancel:<orderId>:<lineItemId>`,
`refund:<refundId>:<refundLineItemId>`, ostatní `<kind>:<runId>:<n>`.

**O2 — Ceny (core `outletPrices`).** Vstup: původní cena (minor units, `exp` měny), `percent`. Výprodejová cena =
`round(original × (100 − percent) / 100)` na minor unit (half up); musí být ≥ 1 minor unit a < original, jinak
„sleva nemá účinek“ (start odmítnut). `compareAtPrice` podle `modules.outlet.display`: `silent` → beze změny (původní
hodnota zůstane), jinak = původní `price` (přeškrtne se skutečná předchozí cena, ne starší `compareAt`). Totéž pro
pevnou cenu ceníku (vlastní měna, vlastní `compareAt`). **Žádný přepočet kurzem** (MKT-1): trh bez pevné ceny dostane
sníženou základní cenu převodem Shopify.

**O3 — Trhy a ceníky (A5).** Základní cena se mění vždy (platí ve všech trzích bez pevné ceny). Ceník s **pevnou
cenou** varianty: merchant ho zaškrtne → pevná cena se sníží stejným %; nezaškrtnutý ceník s pevnou cenou zůstane
(v tom trhu výprodej není — admin to řekne). Ceník bez pevné ceny pro variantu se nemění (převod ze základní).
Výběr ceníků = seznam ceníků s pevnou cenou varianty (čtení `priceList.prices(originType: FIXED)` pro variantu);
ceník, který mezi výběrem a startem pevnou cenu ztratil → `price_list_skipped`. **Kvóta počítá všechny prodané kusy
varianty během běhu, v každém trhu** (rozhodnuto výchozí hodnotou; admin to píše u kvóty).

**O4 — Start (`startOutletRun`).** Pro + validace (kvóta 1–100 000, % 1–90, konec v budoucnu, ≤ 1 běh na variantu,
≤ 100 běhů) → řádek `starting` → přečíst variantu (`price`, `compareAtPrice`, produkt) a pevné ceny vybraných ceníků
→ **záloha** do `backup` → příznak `outlet` (O6, synchronně, chyba = `start_failed`, nic dalšího) → ceny (varianta,
pak ceníky; chyba = vrátit, co se zapsalo, a příznak, `start_failed`) → `active`, `started`. Zámek per shop
(`withConfigLock`), aby se nepotkal se syncem.

**O5 — Konec a návrat cen (`endOutletRun`).** Důvod `quota` (sold − returned ≥ quota), `date` (`endsAt ≤ now`,
scheduler), `manual` (admin). `ending` → přečíst aktuální ceny → každé pole, které má naši výprodejovou hodnotu, vrátit
ze zálohy (`price_restored`); jiné (`price_kept`) nechat → příznak pryč (O6) → `ended`, `endedAt`. Chyba v kterémkoli
kroku: běh zůstane `ending` s `error`, scheduler to zkusí znovu (backoff 1, 5, 15, 60 min) — výprodejová cena nikdy
nezůstane bez příznaku (pořadí).

**O6 — Příznak výprodeje na variantě (upraveno po B0).** Variantní metafield `$app:won_discounts.outlet` = `true`
(type json) na variantě s během `starting` | `active` | `ending` (dokud ceny nejsou zpět, `endedAt` null); start ho
zapíše před cenami, konec smaže po návratu cen. Funkce: pole `wonOutlet: metafield(namespace: "$app:won_discounts",
key: "outlet") { jsonValue }` na `ProductVariant` v obou dotazech; řádek je výprodejový, když `jsonValue === true`
(nebo podle produktového `outlet` z MVP 1, beze změny). App proxy (`cart-plan.server.ts`) a množstevní blok čtou
totéž. Produktový metafield `product` se výprodejem nemění.

**O7 — Objednávky (webhooky).** Scope `read_orders`; témata `orders/create`, `orders/cancelled`, `refunds/create` →
`/webhooks/outlet` (HMAC, rychlá odpověď, idempotentní, chyba DB = 5xx). Pro každý řádek objednávky s variantou běhu
`active` | `ending` (objednávka vytvořená po `startedAt`): `sale` (+qty). Storno: za každý řádek se `sale` a bez
dřívější vratky: `cancel` (−sold, tj. `returned += qty − už vráceno`). Vratka: `refund_line_items` s `restock_type`
≠ `no_restock` k řádku se `sale`: `refund` (`returned += qty`, nejvýš prodané kusy toho řádku). Po `sale`:
`sold − returned ≥ quota` → `quota_reached` → konec (O5) na pozadí. Prodej po vyčerpání (zpoždění webhooku) =
`oversold` (admin ukáže přesné číslo). Storno / vratka po konci → `return_after_end` a podle
`reopenOnReturnAfterEnd`: `auto` (Pro) → znovu otevřít (nový start se stejnými parametry a zbylou kvótou),
`ask` → `returnPending += qty` (Přehled: otázka s jedním tlačítkem „Znovu otevřít“ / „Nechat skončené“), `never` →
jen historie. Ve Free se nikdy znovu neotevírá (A6).

**O8 — Scheduler (`app/lib/jobs/scheduler.server.ts`).** Jeden ticker na proces (minuta), úlohy s vlastním intervalem
a stavem v DB (`JobState { name, lastRunAt, lastError }`), injektované hodiny: `outlet.due` (1 min: konec podle data,
vyčerpaná kvóta, kterou webhook nemohl ukončit, opakování `ending` po backoffu, přerušený start `starting` > 10 min,
znovu zápis hodnoty pro storefront), `history.prune` (denně: události běhů ukončených před > 400 dny; běh zůstává;
plus `pruneExpiredConfigHistory` — dluh MVP 1). Při startu procesu se úlohy, jejichž čas prošel, spustí hned.
**Rozhodnuto výchozí hodnotou:** srovnání nákupních cen (hodinově, ≤ 5 obchodů — dluh MVP 2/3 je tím splněný) a
sweep claimů mají své otestované časovače z MVP 1–2 a zůstávají; scheduler přidává jen úlohy se stavem v DB.

**O9 — Storefront.** Nový blok `outlet_badge` (PDP, jen Liquid, **bez skriptu**) čte produktový metafield
`$app:won_discounts.outlet` (JSON, píše ho výprodej, ne sync): `{ "d": "silent" | "strike" | "strike_badge" |
"strike_badge_left", "v": { "<variant numeric id>": <zbývá ks> } }`, aktualizovaný po každém `sale`/`cancel`/`refund`/
konci (smazán, když na produktu nic neběží). `silent` a `strike` → blok nic nevykreslí (přeškrtnutí je
`compare_at_price` tématu); `strike_badge` → štítek „Výprodej“; `strike_badge_left` → + „Zbývá X ks“ (jen z reálné
kvóty, nikdy < 0; 0 → nic). Produkt s jedinou variantou = jeden štítek; jinak řádek na každou výprodejovou variantu
**s jejím názvem** — správně při jakékoli vybrané variantě, bez JS (rozpočet SF-2 zůstává, rozhodnuto výchozí
hodnotou: přepínací skript by potřeboval ~460 B gz, rezerva je 14 B). Množstevní blok: varianta s příznakem nemá
tabulku ani živou cenu úrovní (prázdný cap jako varianta bez stropu), pokud `outletWithAnything` není zapnuté
(storefront config `ow: 1`). Markery `data-won-discounts-outlet`, `…-outlet-variant`, `…-outlet-badge`, `…-outlet-left`.

**O10 — Admin `/app/outlet`.** Seznam běhů (varianta, sleva, kvóta prodáno / vráceno / zbývá, konec, stav, přeprodáno),
detail s historií kroků, „Nový výprodej“ (výběr varianty Shopify pickerem, kvóta, %, konec, ceníky s pevnou cenou
varianty), „Ukončit výprodej“, u `returnPending` „Znovu otevřít“ / „Nechat skončené“. Nastavení modulu: zobrazení na
webu (4 úrovně, výchozí `strike_badge`) a vratka po konci (výchozí zeptat se). Free: amber `ProFrame` s náhledem,
založení zamčené, běžící běhy „doběhne (A6)“. Přehled: karta Výprodej + otázka u `returnPending`. View model
`OutletScreenData` (types.ts), i18n cs + en, dev harness (`/dev/preview/outlet`, stavy free / pro / running / ask).

**O11 — Skripty a E2E.** `scripts/e2e/outlet.mjs`: `--start` / `--end` / `--status`, výchozí dry-run (vypíše plán
zápisů), `--live` zapisuje přes **tytéž** funkce appky (CLI admin klient, DB appky), záloha do `--out`;
`--verify-restored` porovná ceny se zálohou (3 záznamy). Profil `outlet` (Pro): výprodej `won-e2e-two-variants`
Large (base 18 Kč) a `won-e2e-spare` s ceníkem česko (pevná 199 Kč) → PDP (štítek, zbývá X, množstevní tabulka
skrytá) → Bogus objednávky do vyčerpání kvóty → webhook → ceny vráceny (PDP i `products/*.js`) → storno objednávky →
kus zpět (historie) → úklid. Free (fáze A): `outlet-free` — založení odmítnuto, web beze změny.

## Rozpočet — výprodej (B0, stop-pravidlo zapsané před měřením)

Funkce se nemění, ale MVP 5 začne psát skutečné seznamy `outlet` → přeměřit rodiny cap 550 se seznamy
(`tests/budget-families/outlet-variants.mjs`, HEAD Wasm 245 237 B).

- **Průchod 1 (2026-10-02, nerealistický tvar):** každý produkt dostal seznam se **stejnými** výplňovými GID → 160 DIFF
  (vše délka 5 + shoda varianty) = přijatý rozdíl z README funkce („seznamy se stejnou délkou a prvním prvkem se
  čtou jako jeden“), který sync nikdy nevytvoří; max 101,94 % (režim `miss`, seznam délky 1 na každém produktu).
- **Kontrakt O6 doplněn:** seznam produktu obsahuje **jen GID variant toho produktu** (jinak by platil přijatý rozdíl).
- **Stop-pravidlo (pevně předem):** realistický generátor (seznam per produkt z jeho vlastních GID, výplň unikátní
  pro produkt), seznam nese jen prvních **N** různých produktů vstupu; jeden průchod pro každé N ∈ {100, 50, 25}
  × režimy `miss`/`last`/`every10`. Zvolí se **největší N s max < 100 % a 0 DIFF**; když ani N = 25 nevyhoví:
  rozhodnout o úpravě funkce.
- **Výsledek (2026-10-02):** 0 DIFF ve všech třech, ale max **102,38 %** pro N = 100, 50 i 25 (≥ 100 %: 2 029 / 1 230 /
  1 230 vstupů). Diagnostika na jednom vstupu (`t-top h136-0000 … keep-t9`, bez seznamu 93,69 %): už **samotný klíč**
  `outlet` v produktovém metafieldu stojí ~1,7 tis. instrukcí na řádek (každý řádek čte vlastní kopii mapy produktu),
  seznam o 1 prvku dalších ~2,3 tis. — u 200 řádků ~+9 bodů; počet produktů se seznamem to neřeší.
- **Rozhodnutí (úprava funkce, spec §4.4 „příznak outlet do variant metafieldu“):** příznak je **variantní metafield
  `$app:won_discounts.outlet` = `true`** (json), v dotazu funkce pole `wonOutlet` na `ProductVariant` (oba targety);
  řádek je výprodejový, když `wonOutlet.jsonValue === true` **nebo** (beze změny) podle produktového `outlet`. Sync
  produktů výprodej neřeší, příznak píše a maže jen výprodej (vlastní klíč, žádný souběh se syncem ani se zrcadlem
  nákupních cen `variant`). TS reference + Rust + fixtures + parita + replay + přeměření rodin s polem `wonOutlet`
  (null / true) na novém Wasm.

- **Přeměření s variantním příznakem (2026-10-02, Wasm 245 497 B, `outlet-flag-variants.mjs`, stop-pravidlo: jeden
  průchod, žádné stupňování):** rodiny cap 550 × `wonOutlet` null / každý 10. řádek / všechny (9 960 běhů) max
  **99,80 %** (null na všech řádcích = nejdražší; výprodej řádky zlevní), 0 ≥ 100 %, 0 DIFF; rodiny s odměnami (malý
  payload, MVP 4 99,32 %) × `wonOutlet` null (6 640 běhů) max **99,89 %**, 0 ≥ 100 %, 0 DIFF. **Riziko (P3): rezerva
  0,11 bodu** — každé další čtení per řádek v MVP 6–7 nejdřív uvolní instrukce (README funkce). Oba dotazy 30/30 bodů.

## Úkoly po vrstvách

1. **B0 rozpočet** ✓ (2026-10-02) — HEAD Wasm (245 237 B, = MVP 4) na rodinách cap 550: 3 320 vstupů, max 99,21 %,
   0 DIFF (shodné s MVP 4; s odměnami 99,32 % z auditu MVP 4, tentýž Wasm). Seznamy `outlet`: viz „Rozpočet — výprodej“.
2. **Core** `packages/core/src/discounts/outlet.ts` (+ testy): `outletPrices`, `outletLedger` (sold/returned/left/
   oversold), `outletTransition` (start/sale/cancel/refund/end/reopen podle stavu, tarifu a nastavení),
   `outletStorefrontValue`; `productMetafieldValue` + `outlet`; `isEmptyEntry`.
3. **Sync** — `outlet` v hodnotě produktu z DB, outlet lane, testy integrace.
4. **Server výprodeje** — Prisma migrace, `app/lib/integration/outlet.server.ts` (start, end, události), webhook route,
   scheduler + převod dnešních jobů, testy (falešný Admin klient, injektované hodiny).
5. **Storefront** — uvolnit místo v JS, blok `outlet_badge`, data `o` v množstevním bloku, contract testy.
6. **Admin** — obrazovka, Přehled, harness, i18n, UI testy, screenshoty 390/1440.
7. **Docs** — concepts/outlet, tasks (založit, ukončit, trhy), support (vratky, přeprodej, cizí změna ceny), Free vs Pro.
8. **E2E** — skript `outlet.mjs`, profil `outlet`, `phase-b.sh`, runbook.

## Živá fakta k ověření

- F-O1: přístup appky k objednávkám. **Ověřeno 2026-10-02 (sonda):** `read_orders` + odběr `orders/create` v toml →
  `shopify app dev`: „This app is not approved to subscribe to webhook topics containing protected customer data“.
  **Předpoklad pro Ondřeje** (nejde zajistit z CLI, přihlášení do Partner Dashboardu nesmím): Partner Dashboard →
  Apps → won-discounts → API access requests → Protected customer data access → Request access → zvolit „Protected
  customer data“ (úroveň 1, **žádná chráněná pole** — jméno, adresa, e-mail, telefon nepotřebujeme), důvod „počítání
  prodaných kusů výprodeje z objednávek“, uložit; vyplnit Data protection details. Pro dev store se na review
  nečeká (shopify.dev „Work with protected customer data“). Do té doby se staví a testuje vše kromě živého E2E
  objednávek (webhook handler testy s podepsanými payloady).
- F-O4b: **storno v E2E** — `orderCancel` potřebuje `write_orders`, které appka sama nepotřebuje. Doporučení:
  testovací objednávky `won-e2e` stornovat Ondřejovým CLI loginem (`shopify store execute --allow-mutations`, jen
  `orderCancel` objednávek, které E2E samo vytvořilo) — vyžaduje Ondřejův souhlas, protože pravidla dovolují store
  execute jen ke čtení. Fallback: storno ověřené jen testy handleru (podepsaný payload).
- F-O2: `priceListFixedPricesUpdate` mění pevnou cenu a `compareAtPrice` ceníku česko; pokladna v trhu cesko účtuje
  výprodejovou pevnou cenu.
- F-O3: Horizon i Dawn ukážou přeškrtnutí z `compare_at_price` bez zásahu appky. **Ověřeno 2026-10-02 (živé E2E
  + sonda Admin API `contextualPricing`): platí jen částečně** — v trhu s ceníkem (česko, Slovensko; `compareAtMode`
  ADJUSTED) Shopify u varianty bez pevné ceny vrací kontextově `compareAtPrice: null`, i když varianta compare-at má;
  cena výprodeje se propíše (13,50 Kč, 0,56 €). U pevné ceny ceníku přeškrtnutí funguje (výprodej píše compare-at
  pevné ceny). Rozhodnuto výchozí hodnotou: poctivá věta v adminu a docs, štítek bloku se ukazuje vždy; zápis pevných
  cen do ceníků ve stejné měně kvůli přeškrtnutí = otázka pro Ondřeje (mění chování ceníku).
- F-O4: storno objednávky (`orderCancel` s `restock`) pošle `orders/cancelled`; vratka `refunds/create`.
- F-O5: funkce vyřadí řádek výprodeje z kódu/automatické slevy v pokladně (A1).

## Aktivace 5b (po schválení chráněných dat, F-O1)

Stav 2026-10-02 (5a): admin poctivě říká „Kvóta se zatím neodečítá — výprodej skončí datem nebo ručně.“
(`app/lib/integration/orders-access.server.ts`: scope `read_orders` v session **a** úspěšné `orders(first:1)`,
cache 60 s, `ACCESS_DENIED` / chyba = nepočítá se). Handler `/webhooks/outlet`, kontrakt O7 a testy s podepsanými
payloady jsou hotové; E2E testy objednávek jsou ve specu `storefront.outlet` vypnuté (`WON_E2E_ORDERS=1`), storno
skript `scripts/e2e/outlet-orders.mjs` (dry-run napřed, jen objednávky tohoto běhu: `--since`, e-mail E2E, Bogus
`test`, řádky jen `won-e2e-*`, nezrušené).

Postup, až Ondřej schválí přístup (každý krok ověřit, než se jde dál):

1. **Sonda** (na začátku každé session): do `[access_scopes] scopes` dočasně přidat `read_orders`, restart
   `shopify app dev`, jako appka `shopify app execute` dotaz `query { orders(first: 1) { nodes { id } } }`.
   `ACCESS_DENIED` → toml vrátit, krátký `shopify app dev` (vrátí konfiguraci), zapsat do build logu, konec.
2. **Toml** (jen po úspěšné sondě): `scopes = "write_discounts,read_products,write_products,read_themes,read_orders"`
   a odběr (komentář odkazuje na F-O1 a handler):
   ```toml
   [[webhooks.subscriptions]]
   topics = [ "orders/create", "orders/cancelled", "refunds/create" ]
   uri = "/webhooks/outlet"
   ```
   Komentář `# Later MVPs add read_orders` přepsat; v hlavičce `webhooks.outlet.tsx` smazat „NOT SUBSCRIBED YET“.
   `shopify app dev` musí konfiguraci přijmout (jinak zpět, jako v kroku 1). V adminu (harness i živě) zmizí banner.
3. **CLI login pro storno (Ondřej, jednou, OAuth v prohlížeči):**
   `shopify store auth -s b2b-b2c-store-development.myshopify.com --scopes read_orders,write_orders,read_products`
   (živě 2026-10-02: uložený store auth objednávky nečte — „Access denied for orders field“). Ověření:
   `node apps/won-discounts/scripts/e2e/outlet-orders.mjs --since <dnes>T00:00:00Z` (dry-run, vypíše objednávky).
4. **E2E**: `WON_E2E_ORDERS=1 bash apps/won-discounts/scripts/e2e/runbook/profile.sh outlet <tag> pro` (app dev
   s `WON_DEV_PLAN=pro`); spec prodá kvótu Large dvěma objednávkami (1 + zbytek) → `quota` konec → ceny zpět, pak
   výprodej Large znovu spustí pro další téma (`outlet.mjs --start --live --only`); spare: objednávka → `sold` +1 →
   storno s restockem → `returned` +1, krok `cancel`. Matice Horizon + Dawn, Free fáze beze změny
   (`profile.sh outlet <tag> free`: testy objednávek se přeskočí, Free výprodej nemá).
5. **Úklid**: `profile.sh` vrátí ceny (`--end`, `--verify-restored`); zbylé objednávky běhu stornovat
   `outlet-orders.mjs --since <start běhu> --live` (dry-run napřed). Evidence `evidence/mvp5/e2e-5b/`.
6. Audit dávky do `audit-mvp5.md`, checkpoint „MVP 5 ✅“, docs (`clearance.md` věta „Not counted yet“ +
   support `clearance-quota-not-counting.md` přepsat na „platí jen bez schváleného přístupu“), commit + push.

## Rozhodnuto výchozí hodnotou

- Sleva výprodeje = procento (1–90 %), stejné pro základní cenu i pevné ceny ceníků (žádná částka → žádný přepočet).
- Kvóta počítá všechny prodané kusy varianty během běhu, ve všech trzích.
- `compareAtPrice` = cena před výprodejem (ne dřívější `compareAt`), `silent` ho nemění.
- Historie: události běhu se mažou 400 dní po jeho konci.
- Limity: 1 neukončený běh na variantu; produkty s během na obchod = N z měření rozpočtu.
- 5a: nezjistitelný přístup k objednávkám (výpadek dotazu) = „nepočítá se“ a nekešuje se (obrazovka nikdy neslíbí
  počítání, které neumí); fixture spare kvóta 2 → 5 (pokladna i storno 5b po jedné objednávce ho nevyprodají).
