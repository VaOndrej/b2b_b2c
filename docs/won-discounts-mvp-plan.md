# Won Discounts — spec a MVP plán do „Shipped“

> Stav: **schváleno** (Ondřej odsouhlasil rozhodnutí 2026-09-28; plán je jejich rozpis,
> ne nový produkt). Zdroje v pořadí priority: [`won-discounts/rozhodnuti.md`](won-discounts/rozhodnuti.md)
> > [`won-discounts/mezery.md`](won-discounts/mezery.md) > [`won-discounts/prompt-orchestrator.md`](won-discounts/prompt-orchestrator.md).
> Stav běhu a verdikty rizik: [`won-discounts-build-log.md`](won-discounts-build-log.md).
> Doktrína: [`won-app-design-doctrine.md`](won-app-design-doctrine.md) (cituju `§n` / `XXX-n`).
>
> Místa označená **[spec]** jsou volby tohoto rozpisu tam, kde rozhodnutí mlčí.
> Jsou vratné a nemění žádné rozhodnutí; když je prototyp vyvrátí, upraví se tady
> a zapíše do build logu.

---

## 0. Vůdčí principy

1. **Jedna appka, pět modulů, jeden engine.** Slevy a kódy · Množstevní slevy · Odměny za
   košík · Výprodej (Pro) · Ochrana marže. Každý modul odpovídá na jednu otázku merchanta.
   Plánování, cílení a jazyky jsou vlastnosti pravidel, ne moduly. Kampaně (Pro) jsou vrstva
   nad moduly, ne šestý modul.
2. **Jeden mozek, víc rukou (C1).** Pod moduly je čistý, deterministický engine
   `@won/core/discounts` → `planCart(cart, config, context)` vrací **celý plán slev pro košík
   a jeho vysvětlení**. Tentýž plán počítá každý Won uzel ve funkci, admin („Vyzkoušet
   košík“), náhled i storefront. Každý uzel pak vydá jen svůj díl. DATA-4, §10b.
3. **Všechny slevy obchodu jdou přes Won.** Jen tak engine zná všechno, co se uplatní.
   Nativní slevy detekujeme vždy a nabízíme jednoklikový přesun se zálohou a undo.
4. **Dárek se nikdy neplatí a checkout se nikdy neblokuje.** Žádná validační funkce na
   blokaci. V pokladně dárek zůstane zdarma, pokud ho zákazník měl v košíku (práh se
   ve funkci počítá z ceny **před** ostatními slevami). Rozhoduje se v košíku.
5. **Ochrana marže nikdy neblokuje, jen snižuje.** Když by kombinace slev podlezla minimum,
   sleva se sníží na hranici. Platí ve Free, platí i uvnitř kampaní.
6. **Per trh / měna, nikdy přepočet kurzem.** Každý práh i pevná částka má vlastní hodnotu
   pro každou měnu trhu (CZ 1000 Kč, SK 60 €). Trh bez hodnoty = odměna / pevná sleva se
   v něm nenabízí a admin na to upozorní. MKT-1.
7. **Merchant není svázaný našimi rozhodnutími.** Sporné chování (dárek vs. kód,
   znovuotevření výprodeje, kombinace) je volba v Nastavení s fungující výchozí hodnotou
   a vysvětlením „co to udělá“ (§10 Effect Proof).
8. **Merchant není přehlcený.** Onboarding do 3 minut, pokročilé volby pod „Další
   možnosti“ (§9), sekce vede stavem, ne schématem (§17).
9. **Každá otázka = jedno tlačítko, které akci provede** (§13). „Máš 4 slevy v Shopify,
   přesunout?“ → Ano → hotovo.
10. **Náhled je věrný živému tématu** (C5), ne vymyšlený vizuál. A1, §1.
11. **Poctivost** (§12): „zbývá X ks“ jen z reálné kvóty, žádné „appka ti vydělala X“ bez
    kontrolní skupiny, přesné přiznání přeprodaných kusů u výprodeje.
12. **Free omezuje rozsah, ne kvalitu.** Konzistence košík ↔ pokladna, ochrana marže, a11y,
    náhled a kód v košíku jsou ve Free plné. BILL-1: entitlement jen ze serveru.

### Problémy zákazníka vs. merchanta

| Zákazník (shopper) | Merchant |
|---|---|
| Nevím, kolik ušetřím a proč (sleva „zmizí“ v pokladně) | Slevy z různých appek se perou, nevím, co se reálně uplatní |
| Zadám kód a přijdu o dárek, aniž by mi to kdo řekl | Kombinace slev mi prožere marži |
| Nevím, kolik mi chybí do dopravy zdarma / dárku | Výprodej = ruční přepisování cen, kopie produktů, rozbitá SKU |
| Množstevní cena se ukáže až v košíku | Black Friday = desítky ručních kroků v přesný čas |
| Dárek v pokladně „zdraží“ | Limit 25 funkcí, 10 kB configu — nechci to vůbec řešit |

---

## 1. Architektura

```
Admin (React Router + Polaris web components, embedded, App Bridge)
  │  config (verzovaný, sanitizovaný) · Vyzkoušet košík · přesun nativních slev
  │  Prisma (SQLite dev / Postgres prod)
  ▼
Sync vrstva (server, jediný zapisovač do Shopify)
  ├─ discount-node metafield  $app:won_discounts/config   (globální pravidla ≤ 10 kB, C3)
  ├─ product/variant metafields $app:won_discounts/*      (data per produkt: sady úrovní Pro,
  │                                                          nákupní cena, výprodej, C3)
  ├─ app-data metafield (AppInstallation) storefront       (config pro theme extension)
  └─ Won discount uzly (C1/C2):
        N-auto  „Won Discounts“          automatic app discount, třídy PRODUCT+ORDER+SHIPPING
        N-code-<pravidlo>                 code app discount na KAŽDÉ kódové pravidlo, všechny
                                          jeho kódy jako redeem kódy (C2 fallback, §3)
                                          ▼
                       Discount Function `won-discounts-engine` (JS, 2 targety)
                         cart.lines.discounts.generate.run
                         cart.delivery-options.discounts.generate.run
                         → planCart(...) (tentýž core, bundlovaný) → vydá jen svůj díl

Theme app extension `won-discounts-storefront`
  app embed (košík: progress, dárek + Odmítnout, pole pro kód + varování, „Ušetříš X“,
             tip „přidej 1 ks“; BETA ceny na kartách) · bloky: množstevní tabulka + živá cena
             (PDP), štítek výprodeje · config z app-data metafieldu (bez síťového volání)
App proxy `/apps/won-discounts/*`  health · (MVP4) živý plán košíku · náhledový parametr pro
                                   „Zobrazit na mém webu“ (C5 fallback: storefront nejde do iframe)
Webhooky  orders/create · orders/cancelled · refunds/create (výprodej, analytika) ·
          app/uninstalled · GDPR (WBH-3) · app_subscriptions/update (billing)
```

**Proč funkce v JS a ne v Rustu [spec]:** engine musí být *jeden* kód pro admin, storefront
i funkci (DATA-4). JS funkce bundluje `@won/core/discounts` přímo (esbuild přes
`shopify app function build`). Riziko je výkon (instrukční limit funkce); hlídá ho
contract test s velkým košíkem (200 řádků) přes `shopify app function run` a měřením
instrukcí. Fallback, pokud limit nestačí: Rust port jen hot path, stejné fixture testy.

**Co kde žije (DATA-1):**

| Data | Kde | Proč |
|---|---|---|
| Config appky (moduly, engine, trhy, texty, vzhled, kampaně) | Prisma `ShopConfig` (JSON + `schemaVersion`) | Zdroj pravdy, verze, undo (§14) |
| Historie configu | Prisma `ConfigVersion` (retence 90 dní, PRIV-2) | §4b / §14b obnova verze |
| Pravidla pro funkci | metafield na Won uzlu (odvozený, zapisuje jen sync) | Funkce nemá DB |
| Per-produkt data (sady úrovní Pro, nákupní cena, příznak výprodeje) | product/variant metafield `$app` | C3: globální config pod 10 kB |
| Nákupní cena | Shopify `inventoryItem.unitCost` → zrcadlo do variant metafieldu | Funkce ji ve vstupu nemá; zrcadlo s důvodem + resync při změně |
| Záloha nativní slevy | Prisma `NativeDiscountBackup` (raw snapshot) | Undo přesunu, „Připravit na odinstalaci“ (A7) |
| Výprodej | Prisma `OutletRun` + `OutletEvent` (historie kroků) + `OutletLedger` (idempotentní) | Kvóta z objednávek, WBH-2 |
| Analytika | Prisma `OrderDiscountFact` (bez PII) + denní agregát | Přehledy Free/Pro, PRIV-1 |
| Zásahy marže | Prisma `MarginIntervention` (z objednávek, Pro přehled) | Pro přehled zásahů |
| Kampaně | součást configu (`campaigns[]`) + Prisma `CampaignEvent` (start/konec/kill) | Atomicita, audit (AI-2) |
| Tarif | Shopify subscription (autorita) + cache s TTL | BILL-1 |

---

## 2. Config surface (verzovaný od MVP 0, layered)

```ts
interface WonDiscountsConfig {
  schemaVersion: number;            // DATA-3; migrace migrateConfig(vN → vN+1)
  markets: MarketSetting[];         // {handle, currency, enabled} — hodnoty per měna
  engine: EngineSettings;           // kombinování (A1), gift-vs-code chování, zaokrouhlení
  modules: {
    codes: CodesModule;             // pravidla slev: automatická i kódová
    tiers: TiersModule;             // množstevní slevy
    rewards: RewardsModule;         // doprava zdarma, dárek, žebřík (Pro)
    outlet: OutletModule;           // výprodeje (Pro) — nastavení; běhy v DB
    margin: MarginModule;           // ochrana marže
  };
  campaigns: Campaign[];            // Pro; okno + přepisy pravidel
  storefront: StorefrontSettings;   // vzhledy bloků, BETA ceny na kartách, výprodej 4 úrovně
  locales: LocaleDictionary;        // cs/sk/en texty storefrontu, editovatelné (A5, A10)
  onboarding: OnboardingState;      // cíle, kroky 1–5 (jen řazení, moduly vždy viditelné)
}
```

### Klíčové typy (výtah; úplný katalog polí vzniká v `@won/core/discounts/config.ts`)

- **`Money` per měna:** `MoneyByCurrency = Record<CurrencyCode, number>` (v nejmenší jednotce,
  haléře/centy). Chybějící měna = pravidlo v trhu s tou měnou neplatí (A3, princip 6).
- **`DiscountRule`** (modul Slevy a kódy):
  `{ id, enabled, name, method: "automatic"|"code", codes?: string[], value:
  {kind:"percentage", percent} | {kind:"fixed", amount: MoneyByCurrency} | {kind:"freeShipping"},
  target: {kind:"order"} | {kind:"products", productIds, variantIds} | {kind:"collections", ids}
  | {kind:"shipping"}, minimum?: {subtotal?: MoneyByCurrency, quantity?}, schedule?:
  {startsAt, endsAt}, limits?: {usageLimit?, oncePerCustomer?}, targeting?: {segments?,
  markets?} (Pro), combinesWith?: {ruleIds…} (Pro per-sleva), origin?: {nativeId} }`.
- **`TierSet`** (Množstevní): `{ id, scope: "global" | {productIds|collectionIds} (Pro),
  countAcross: "line"|"product"|"cart" (cart = Pro), breaks: [{minQty, percent | amountOff:
  MoneyByCurrency}] }`. Free = právě 1 globální sada.
- **`RewardsModule`:** `freeShipping?: {threshold: MoneyByCurrency}`, `gifts: GiftTier[]`
  (Free 1 práh, Pro žebřík), `GiftTier = {id, threshold: MoneyByCurrency, choices:
  variantId[] (Free 1, Pro až 3), fallbackVariantId?}`, `countOtherDiscounts: boolean`
  (výchozí **ne** [spec] — nejbezpečnější pro zákazníka, dárek nezmizí), `giftDeclinable: true`.
- **`OutletModule`:** `display: "silent"|"strike"|"strike_badge"|"strike_badge_left"`
  (výchozí `strike_badge`, bez „zbývá X ks“), `reopenOnReturnAfterEnd: "auto"|"ask"|"never"`
  (výchozí `ask`).
- **`MarginModule`:** `global: {minMarginPercent?: number (z nákupní ceny), maxDiscountPercent:
  number (produkty bez unitCost, A2)}`, `perCollection: [...]` (Pro).
- **`EngineSettings`:** `combination: {outletWithAnything: false, productWithProduct: "best"
  , productWithOrder: true, productWithShipping: true, orderWithShipping: true}` (A1 výchozí,
  Free přepíná po kategoriích), `perRule` (Pro).
- **`Campaign`:** `{id, name, window: {start, end} (čas obchodu), overrides: RuleOverride[],
  killed: boolean}`.

### Pravidla configu

- **Jediný sanitizer** `sanitizeConfig(input) → {config, issues[]}` v core (DATA-2): clamp,
  enumy, defaulty, odstranění osiřelých referencí, `issues` pro admin (lidsky, §4c).
- **Tolerant reader + migrace** `migrateConfig` (DATA-3); fixture každé verze v testech.
- **Rozpočet velikosti (C3):** do funkce jde jen podmnožina configu (bez textů, vzhledu,
  onboardingu, trhů); **9 000 B** (rezerva 10 % pod ověřenou hranicí 10 000 B) se kontroluje
  pro nejhorší případ (bez kampaně i s každou kampaní živou). Admin nedovolí uložit config,
  který by se nevešel (§13: řekne proč a co s tím).
- **Stropy uloženého configu (audit MVP 0):** každé pole a řetězec má strop (`CONFIG_LIMITS`),
  celý uložený config max. **256 KiB** (`config_too_large`). Id max. 64 znaků `[A-Za-z0-9_-]`;
  neplatné id se deterministicky nahradí a reference přemapují. Onboarding cíle jen ze známého
  výčtu. Číselná pole berou jen `number` (žádná koerce řetězců). Vrácené `issues` jsou omezené
  (prvních 100 + souhrn).
- **Novější verze schématu** (rolling deploy) se jen čte, uložení ji nepřepíše (`newer_schema`).
- **Historie verzí** 90 dní; úklid pro všechny shopy (`pruneExpiredConfigHistory`) se napojí
  na scheduler v MVP 5 (dnes jen při uložení).
- **Data shopu** se mažou v `shop/redact` (~48 h po odinstalaci), ne v `app/uninstalled`
  (zpožděný webhook po reinstalaci by smazal nový config a zálohy nativních slev, A7).
- **Žádné magic numbers** v engine/storefrontu: všechno je pole s defaultem.

---

## 3. Engine: plán košíku, kombinování, vysvětlení

`planCart(input, config, ctx) → CartPlan` — čistá funkce, `node:test`.

```ts
interface CartPlanInput {             // normalizovaný tvar, adaptéry: function input,
  currency: CurrencyCode;             // /cart.js, Storefront API cart, admin simulátor
  countryCode?: string;
  lines: {id, variantId, productId, quantity, unitPrice, compareAtUnitPrice?,
          collectionIds[], unitCost?, outlet?: boolean, attributes: {gift?: string}}[];
  enteredCodes: string[];             // validní zadané kódy (Won i cizí)
  now: {campaignActive?: string|null};// C4: výsledek dateTimeBetween, ne hodiny
  customer?: {segments?: string[]};
}
interface CartPlan {
  lines: {lineId, allocations: {ruleId, module, amount, reason}[], marginCapped?: {...}}[];
  order: {ruleId, amount}[];  shipping: {ruleId, percent}[];
  gifts: {tierId, lineId?, state: "earned"|"missing"|"declined"|"out_of_stock"|"not_offered"}[];
  explain: ExplainItem[];     // „co se uplatní a proč“ — lidské důvody, ne enumy (§4c)
  warnings: {code: "code_loses_gift"|"market_missing_threshold"|..., ...}[];
  progress: {freeShipping?: {remaining, reached}, gifts: [...], tierHint?: {...}};
}
```

### Deterministické pořadí (A1 výchozí)

1. **Výprodej:** řádky s aktivním výprodejem (`outlet=true`) jsou z produktových i
   objednávkových slev **vyřazené** („výprodej se nekombinuje s ničím“). Doprava zdarma
   a dárek se jich netýkají jako slevy, jejich cena se ale do prahu počítá (je to cena, kterou
   zákazník platí) [spec].
2. **Dárkové řádky** (`attributes.gift`) jsou mimo všechny ostatní slevy i mimo ochranu
   marže; dostanou 100 % na `min(quantity, 1)` ks, pokud je práh splněn (bod 5).
3. **Produktové slevy** (automatické + zadané Won kódy s cílem produkt/kolekce + množstevní
   úrovně): na každý řádek **vyhrává výhodnější pro zákazníka**, nesčítají se. Remíza →
   stabilní pořadí `priority desc, id asc`. Pro: per-sleva `combinesWith` smí povolit součet.
4. **Objednávkové slevy** (procento / pevná částka z měny košíku) se sčítají s produktovými.
   Mezi sebou: vyhrává výhodnější [spec, shodně s produktovými].
5. **Práh odměn** = mezisoučet nedárkových řádků **před** slevami (výchozí). Když
   `countOtherDiscounts=true`, košík (storefront + plán) počítá práh po slevách a vydá
   varování `code_loses_gift`; **funkce ale v pokladně vždy počítá před slevami**, takže
   dárek, který byl v košíku, zůstane zdarma (rozhodnutí „Dárky vs. další slevy“).
6. **Doprava zdarma** (práh per měna, nebo kód typu doprava) se sčítá s produktem i objednávkou.
7. **Ochrana marže** (vždy poslední): pro každý řádek `floor = max(unitCost × (1 +
   minMargin), …)`; bez `unitCost` `floor = price × (1 − maxDiscountPercent)` (A2). Produktová
   alokace se ořízne na `price − floor`. Objednávková sleva se omezí konzervativně:
   `D ≤ min_i(headroom_i / share_i)` (Shopify rozpočítá objednávkovou slevu poměrně), takže
   žádný řádek nepodleze minimum. Oříznutí → `marginCapped` + vysvětlení.
8. **Kampaň** (Pro): když `now.campaignActive = id`, přepisy kampaně se aplikují na config
   **před** krokem 1; marže platí dál.

### Emise per uzel (C1 platí, C2 fallback — verdikty MVP 0)

- **Uzly:** jeden automatický uzel `Won Discounts` (automatická pravidla, množstevní úrovně,
  dárky, doprava z prahu) + **jeden kódový uzel na každé kódové pravidlo** (všechny kódy toho
  pravidla jako redeem kódy: newsletter, influenceři…). Kódy **jednoho** pravidla se v jednom
  košíku nesčítají (z uzlu se uplatní max. 1 kód — ověřeno C2); kódy **různých** pravidel ano,
  pokud to dovolí kombinování (A1).
- **Tentýž plán v každém uzlu:** každý uzel vidí všechny zadané platné kódy
  (`enteredDiscountCodes`, ověřeno C1) a spočítá celý plán `planCart`. Vydá jen alokace pravidel,
  která vlastní: automatický uzel automatická pravidla, kódový uzel pravidlo, jehož kód je
  `triggeringDiscountCode`.
- **Nejvýš jedna produktová alokace na řádek** (mimo Plus platí Shopify 1 produktová sleva na
  řádek — ověřeno C1/C2). Engine vybere na každém řádku jednoho vítěze a emituje ho jen uzel,
  který ho vlastní. Součet per sleva (Pro) emituje jako jednu hodnotu uzel pravidla s nejvyšší
  prioritou.
- **Kód, jehož uzel nic nevydá, ukáže Shopify jako neuplatněný** (`applicable: false`). Proto
  hodnotu kódu nikdy nevydává automatický uzel a košík (storefront) poctivě vysvětlí proč
  („máš výhodnější slevu“, „kód se na tyto produkty nevztahuje“).
- **Admin limit (C2 fallback):** počet aktivních kódových pravidel je omezený (každé = 1 uzel).
  Přesné číslo podle limitu Shopify ověří MVP 1; admin ho poctivě vysvětlí a nedovolí překročit.
- **Transport configu (C7 platí, MVP 1):** sdílený config funkce je **app-owned shop metafield**
  `$app:won_discounts/function_config` — jeden atomický zápis pro všechny uzly. Uzel má jen malé
  proměnné (`role`, `ruleId`, `campaignId`, `campaignStart/End`, `varsVersion`); okno kampaně
  musí zůstat v uzlu (proměnné dotazu čte Shopify jen z metafieldu uzlu). Neatomický zápis
  proměnných při změně kampaně řeší verze: uzel použije přepisy kampaně jen když jeho
  `campaignId` + `varsVersion` odpovídá shop configu, jinak se chová jako bez kampaně.
  Shop config nad 10 000 B dorazí jako `null` **bez chyby** → rozpočet 9 000 B při uložení,
  sync po zápisu config zpětně přečte a Přehled ukáže „config chybí / je neplatný“.
- **Transport v MVP 0 (C3, C4):** metafield `function_config` byl zároveň zdroj proměnných dotazu.
  Chybějící klíč `campaignStart/End`, chybějící metafield nebo hodnota nad 10 000 B → funkce
  selže (`InvalidVariableValueError`) a uzel nedá žádnou slevu (checkout se neblokuje). Proto:
  rozpočet 9 000 B hlídaný při uložení, sync zapisuje klíče vždy, contract test. [spec] MVP 1
  oddělí malé proměnné (`function_vars`: časy kampaně) od configu čteného přes
  `discount.metafield`, aby přetečení configu neshodilo i časovou logiku.
- Won uzly mají `combinesWith` product/order/shipping = true (engine sám řeší vylučování);
  cizí (nativní) slevy engine nevidí — proto detekce a přesun (princip 3).

---

## 4. Moduly — rozsah

### 4.1 Slevy a kódy (Free: všechny typy, neomezeně; Pro: cílení segment/trh, kombinace per sleva)
- % / pevná částka per měna na produkty, kolekce, objednávku; doprava zdarma; kódem nebo
  automaticky; minimum košíku per měna; plán `startsAt/endsAt`; limity použití (nativní pole
  kódového uzlu); uvítací / newsletter kód jako recept.
- **Detekce nativních slev** (vždy): Přehled ukáže slevy mimo Won + konflikty.
- **Přesun** (jedno tlačítko, C6): záloha → smazání nativní → vytvoření ve Won. Dialog
  předem řekne, co se ztratí (historie použití, „1× na zákazníka“), podle verdiktu prototypu.
  **Undo** = obnova nativní ze zálohy a smazání Won pravidla. Nepřenositelné typy (BOGO,
  cizí app slevy) se nepřesouvají, admin řekne proč.

### 4.2 Množstevní slevy (Free: 1 globální sada; Pro: sady per produkt/kolekce, počítání přes košík)
- PDP blok: tabulka úrovní + živá cena podle počtu kusů (rescan na `shopify:product:select`,
  `input.form`, nova-aplikace §8). Tip v košíku „přidej 1 ks → nižší cena“.

### 4.3 Odměny za košík (Free: doprava zdarma + 1 dárkový práh per měna; Pro: žebřík, výběr ze 3)
- Dárek = **reálný skladový produkt** přidaný do košíku embedem s atributem `_won_gift`;
  funkce ho zlevní na 0. Vyprodaný dárek se nenabízí, lišta to poctivě řekne; volitelně
  záložní dárek (A4). „Odmítnout“ = dárek se v košíku nevrací (atribut košíku
  `_won_gift_declined`).
- Pole pro kód v košíku (`/cart/update.js` `discount`, čtení `discount_codes[].applicable`)
  + varování „s tímhle kódem přijdeš o dárek“ a volba zákazníka. Souhrn „Ušetříš X“.
- Konvence pro Won Toasts: `_gift_progress` / milník (A11), bez tvrdé závislosti.

### 4.4 Výprodej (Pro, celý modul)
- Varianta + kvóta + sleva + volitelně konec + trhy (A5: i pevné ceny v cenících trhů).
- Start: záloha původních `price`/`compare_at_price`/fixních cen → nastavení výprodejových cen
  → příznak `outlet` do variant metafieldu. Prodej z `orders/create`, storna
  (`orders/cancelled`) a vratky (`refunds/create` s restockem) se vrací do kvóty (varianta B),
  idempotentně (WBH-2). Konec (kvóta / datum / ručně / downgrade doběhne, A6) → návrat cen.
- Vratka po konci → podle `reopenOnReturnAfterEnd` (výchozí zeptat se: Přehled ukáže otázku
  s jedním tlačítkem). Přeprodané kusy kvůli zpoždění webhooku admin přizná přesným číslem.
- 4 úrovně zobrazení na webu; „zbývá X ks“ jen z reálné kvóty (§12).

### 4.5 Ochrana marže (Free: globální minimum; Pro: per kolekce + přehled zásahů)
- Minimum z nákupní ceny; bez nákupní ceny „max. sleva X %“ a admin ukáže počet produktů bez
  ceny (A2). Snižuje, nikdy neblokuje. Platí i v kampaních.

### 4.6 Kampaně (Pro)
- Pojmenované okno (čas obchodu) + přepisy pravidel napříč moduly Slevy a kódy / Množstevní /
  Odměny [spec: výprodej má vlastní datum; běžící výprodeje se v kampani jen zobrazí].
- Start a konec atomicky (C4: funkce sama pozná okno přes `shop.localTime.dateTimeBetween`
  s proměnnými z metafieldu uzlu → žádný cron na kritické cestě). Po konci se přepis sám
  zruší. Náhled košíku „v době kampaně“ (Vyzkoušet košík s přepínačem času), okamžitý kill
  switch, zákaz překryvu (A8).

---

## 5. Admin IA a UX

- **Přehled:** co běží, stav embedu (`embed-status.ts` vzor z Toasts), „slevy platí
  v pokladně“ (poslední ověření), upozornění (sleva mimo Won, trh bez prahu, zásah marže,
  výprodej čeká na rozhodnutí) — každé s jedním tlačítkem (§13), čísla (analytika).
- **Moduly** (vždy všech 5, cíle z onboardingu jen řadí): každý modul = studio shell
  (§7b, A7: `WonSection`/`WonBlock` + `describe*()` formátovače z core, §17a).
- **Kampaně** (Pro, amber §16). **Vyzkoušet košík:** produkty + trh + kód (+ čas kampaně) →
  plán s vysvětlením (engine) a **ověření naživo**: stejný košík přes Storefront API cart
  (reálné funkce) → shoda plán ↔ realita. **Vzhled:** předpřipravené vzhledy bloků; Pro vlastní
  vzhled + návod pro AI. **Nastavení** (hraniční chování, trhy, jazyky). **Tarif.**
- **Onboarding (cíl < 3 min):** 1 „Co chceš řešit?“ → 2 nativní slevy „Přesunout“ (jen když
  jsou) → 3 aktivace embedu (deep link do theme editoru, autodetekce) → 4 první pravidlo
  z receptu s předvyplněnými hodnotami a náhledem → 5 checklist „Hotovo“.
- Jazyk adminu cs/en podle jazyka Shopify adminu (A10).
- **Dev-only harness** `/dev/preview/*`: obrazovky adminu s mock session a fixture daty pro
  screenshoty 390/1440. **Neexistuje v produkčním buildu** (contract test).

---

## 6. Storefront (theme app extension, Horizon + Dawn)

- App embed `won-discounts` (jeden malý raw JS + CSS, SF-1 izolace, SF-2 rozpočet
  ≤ 10 kB gz JS [spec]), bloky `quantity-tiers` (PDP) a `outlet-badge`.
- Config z app-data metafieldu v Liquidu (žádný fetch na kritické cestě); měna z
  `cart.currency` / `/cart.js`.
- Vlastní markery pro E2E (`data-won-discounts-*`), ne DOM tématu (nova-aplikace §6).
- Předpřipravené vzhledy (Free) = sady CSS proměnných; Pro vlastní vzhled + „návod pro AI“
  (datový kontrakt, eventy, CSS proměnné, příklad) — SEC-3: vlastní CSS jen scoped.
- **BETA:** ceny podle množství na kartách a ve vyhledávání (merchant zapne v adminu).
- **Pokladna:** nic vlastního, jen názvy slev z funkce (lokalizované).
- **Věrný náhled (C5 → fallback, MVP 0):** storefront nejde vložit do iframe (`x-frame-options:
  DENY`, `frame-ancestors 'none'`). Náhled v adminu = sdílený renderer bloků krmený tokeny
  živého tématu (barvy, fonty, radius ze `settings_data.json` přes `read_themes`) + tlačítko
  „Zobrazit na mém webu“ s náhledovým parametrem.

---

## 7. Free / Pro a billing

| | Free | Pro |
|---|---|---|
| Slevy a kódy | Všechny typy, neomezeně | + cílení segment / trh |
| Množstevní slevy | 1 globální sada úrovní | Sady per produkt / kolekce, počítání přes košík |
| Odměny | Doprava zdarma + 1 dárkový práh, práh per trh / měna | Žebřík prahů, výběr ze 3 dárků |
| Výprodej | — | Celý modul |
| Ochrana marže | Globální minimum | Per kolekce + přehled zásahů |
| Engine | Kombinace po kategoriích, náhled, kód v košíku | + kombinace per sleva |
| Kampaně | — | ✓ |
| Přehledy | Základní čísla | Cena vs. výnos per pravidlo |
| Vzhled | Předpřipravené vzhledy | + vlastní vzhled + návod pro AI |

- Pro **$29 / měsíc flat, USD, 14denní trial**, bez ročního tarifu (A9). Billing API
  `appSubscriptionCreate` (na dev storu `test: true`). Entitlement přes
  `@won/app-kit/entitlement` `resolveEntitlement`, default Free (BILL-1).
- Pro funkce se ve Free **ukazují** s amber markerem a náhledem (§16), na storefrontu se bez
  entitlementu nevydají (sanitizace configu podle plánu na serveru: `gateConfigForPlan`).
- **Downgrade (A6):** běžící výprodeje a kampaně doběhnou, nové nejdou založit.
- **Odinstalace (A7):** „Připravit na odinstalaci“ (i v Tarifu) ukončí výprodeje (vrátí ceny)
  a obnoví nativní slevy ze zálohy.

---

## 8. Analytika (Free / Pro)

- Zdroj: `orders/create` → `OrderDiscountFact` (id objednávky, měna, mezisoučet, slevy per
  Won pravidlo z `discountApplications`, dárky, výprodejové řádky). **Žádná PII** (PRIV-1).
- Free: objednávky se slevou, kolik slevy stály, průměrná objednávka.
- Pro: cena vs. výnos per pravidlo, rozdané dárky, výprodej prodáno X z Y, zásahy marže.
- Bez „appka ti vydělala X“ (§12, EXP-1). Grafy + barva, ne zeď čísel (§3f).

---

## 9. Guardrails

- Config nad rozpočtem funkce nejde uložit (C3). Limit kódů na uzel podle verdiktu C2.
- Funkce: žádná výjimka nesmí shodit checkout — chyba parsování configu = žádné slevy + log,
  nikdy blokace (princip 4). Test s poškozeným metafieldem.
- Dárek nikdy nepodleze 0 ani nebude placený v pokladně; ochrana marže dárky ignoruje.
- Všechny zápisy do Shopify jdou přes sync vrstvu: idempotentní, s retry/backoff (API-3,
  REL-2), zálohou před destruktivní změnou (§14c).
- SEC-2: každý dotaz filtrován `shop` ze session; multi-shop test.

---

## 10. MVP žebřík

Společná brána každého MVP: `npm run test:packages` · `npm run test:unit -w won-discounts` ·
`npm run typecheck -w won-discounts` · `npm run lint -w won-discounts` ·
`npm run build -w won-discounts` (vč. buildu funkcí) · `npm run validate:shopify`
(rozšířeno o extension won-discounts) · `npm run guard:test:core` + **živé E2E Horizon +
Dawn bez `--bail`** (oba `✓`) + vizuální QA 390/1440 (storefront + admin harness) +
`won-auditor` + self-audit + roadmap sync + build log + commit/push.

| MVP | Zákaznická hodnota | Merchant hodnota | Technický rozsah | Exit kritéria (navíc ke společné bráně) | Badge |
|---|---|---|---|---|---|
| **0** | — | — | Scaffold, config v0 (schema, sanitizer, migrace), discount funkce s **prototypovými módy** (echo kódů, % na vše, okno kampaně, produktový metafield — nahradí je engine v MVP 1), theme app extension s embedem, dev harness, prototypy C1–C5 | Každé riziko C1–C5 má verdikt „platí / fallback“ s důkazem (`shopify app function run`, E2E, screenshot); spec upravený podle verdiktů | Scaffold |
| **1** | Sleva / kód platí v košíku i pokladně | Engine, Slevy a kódy, detekce + přesun nativních slev s undo, Vyzkoušet košík, Přehled v1, onboarding 1–3 | `@won/core/discounts` (plan, kombinace, vysvětlení), sync vrstva, N-auto + N-code-<pravidlo> (§3) | Kód i automatická sleva platí v pokladně (E2E Bogus). Přesun + undo fungují na dev storu. Kombinace A1 pokryté unit testy na hranice | Alpha |
| **2** | — | Ochrana marže (globální Free; per kolekce + zásahy Pro; bez unitCost → max %) | Marže v engine, zrcadlo unitCost, seed nákupních cen | Žádná kombinace slev v E2E nepodleze minimum; sleva se sníží, nikdy neblokuje | Alpha |
| **3** | Tabulka a živá cena na PDP | Množstevní slevy + vzhledy bloků | PDP blok, embed základ, předpřipravené vzhledy | Horizon i Dawn: tabulka se zobrazí, 3 ks → sleva v `/cart.js` (`line_level_discount_allocations`) i v pokladně | Beta |
| **4** | Progress, dárek, kód v košíku, „Ušetříš X“ | Odměny (doprava, dárek, žebřík Pro, prahy per trh) | Košík v embedu, gift atributy, delivery target | Scénáře „Dárky vs. další slevy“ v E2E: dárek v pokladně vždy $0; kód pod práh → varování + volba; odmítnutý dárek se nevrací; CZ i SK práh | Beta |
| **5** | Přeškrtnutá cena, štítek | Výprodej (Pro) | Price/compare_at + price lists, webhooky, ledger, historie | E2E: výprodej → objednávky do vyčerpání → cena se vrátí; storno vrátí kus; ceník trhu se upraví a vrátí | Beta |
| **6** | — | Kampaně (Pro) | Okno + přepisy, C4, kill switch, zákaz překryvu | E2E: kampaň začne a skončí (čas podle C4), po konci stav jako předtím | Beta |
| **7** | — | Onboarding < 3 min, Přehled, Vzhled Pro + návod pro AI, analytika, billing + downgrade + „Připravit na odinstalaci“, BETA ceny na kartách, support docs, Dockerfile + fly.toml, BFS kontrola | Billing API, docs generátor + drift test | Celá brána + E2E obě témata bez `--bail` zelené; roadmap badge `Shipped`; nic nasazeného | Shipped |

Onboarding, Přehled a support docs (`apps/won-discounts/docs/`, nova-aplikace §9) rostou
s každým MVP; MVP 7 je jen dotahuje.

### Testovací scénáře (spec-driven, červené první)

- **Core (`node:test`)**: sanitizer + migrace (fixture v0), `planCart` hranice A1 (produkt
  vs. produkt vyhrává výhodnější, produkt + objednávka + doprava se sčítají, výprodej
  s ničím), dárek práh před slevami, `countOtherDiscounts` varování, měna bez hodnoty = nic,
  marže clamp (unitCost / max %), objednávková sleva nepodleze floor na žádném řádku,
  emise per uzel sečtená = plán, rozpočet 9 000 B.
- **Contract**: funkce `shopify app function run` nad fixture vstupy (auto uzel, kódový uzel,
  poškozený metafield), dev harness mimo produkční build, app proxy autentizace, embed markery.
- **E2E (Horizon + Dawn)**: podle exit kritérií výše, přes `@won/testing/playwright`.

---

## 11. Rizika a prototypy MVP 0

| # | Otázka prototypu | Primární cesta | Předem schválený fallback | Verdikt MVP 0 |
|---|---|---|---|---|
| C1 | Vidí kódový i automatický uzel všechny zadané Won kódy (`enteredDiscountCodes`) a dá součet emisí stejný plán? | Jeden mozek, víc rukou (§3) | `combinesWith` + konzervativní strop marže v každém uzlu | **platí** (1 produktová alokace na řádek, viz §3) |
| C2 | Jde na jeden kódový uzel přidat víc redeem kódů a funkce pozná použitý kód (`triggeringDiscountCode`)? Kolik Won kódů jde kombinovat v jednom košíku? | Jeden kódový uzel s více kódy | Limit počtu kódů v adminu, poctivě vysvětlený | **fallback**: uzel na kódové pravidlo, limit aktivních kódových pravidel |
| C3 | Kolik pravidel se vejde do 9 000 B; čte funkce per-produkt metafieldy? | Globální pravidla na uzlu, data per produkt v metafieldech | Tvrdý strop počtu pravidel v adminu | **platí** (hranice přesně 10 000 B) |
| C4 | Pozná funkce okno kampaně přes `shop.localTime.dateTimeBetween` s proměnnými z metafieldu? | `shop.localTime` ve funkci | Nativní `startsAt`/`endsAt` na uzlech | **platí** (klíče povinné) |
| C5 | Jde storefront vložit do iframe adminu (frame-ancestors) s náhledovým tokenem přes app proxy? | Iframe + náhledový token | Náhled s tokeny tématu + „Zobrazit na mém webu“ | **fallback** |
| C6 | — | Rozhodnuto: záloha → smazání nativní → vytvoření ve Won | — | rozhodnuto |

Verdikty a důkazy: build log.
