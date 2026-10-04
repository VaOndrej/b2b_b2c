# Won Discounts MVP 7 — Dotažení (implementační plán, inline)

> Zadání: [`../won-discounts/prompt-mvp7.md`](../won-discounts/prompt-mvp7.md) (rozhodnutí Ondřeje 2026-10-04, body 1,
> 3–6). Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §5–§8, §10. Mezery A6, A7, A9, A13.
> Dluh: build log „Parkované otázky a dluh“. Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md).
> Práce **inline bez subagentů**. Po MVP 7 je appka `Shipped` = připravená k nasazení, **nenasazená**.

**Goal:** Merchant projde onboarding do 3 minut (kroky 1–5), na Přehledu vidí čísla, zaplatí Pro ($29 / měsíc,
14 dní zkouška) a umí z něj odejít bez škody (doběh A6, „Připravit na odinstalaci“ A7). Pro si upraví vzhled a dá
ho udělat AI podle návodu. Množstevní ceny jdou zapnout i na kartách produktů (BETA). Appka má image a `fly.toml`,
běží na Postgresu a má dokumentaci pro support a chatbot.

## Global Constraints

- Vše z plánů MVP 0–6.1: jen dev store, žádný `shopify app deploy` / `fly deploy`, povolené cesty, tajné soubory
  nečíst, žádný prettier, `extensions/**` neměnit při běžícím `shopify app dev`, testy červeně první, po každé
  vrstvě celý `npm run test:unit -w won-discounts`, vrstva = commit.
- **Funkce se nemění** (rezerva instrukcí živé kampaně 0,10 bodu, Wasm 249 111 B). Co by ji měnilo, je mimo MVP 7.
- **`shopify.app.toml`:** žádný scope ani téma, které Shopify dev appce neschválil (`read_orders`, `orders/*`,
  `refunds/*`). `app_subscriptions/update` scope nepotřebuje a smí se přidat.
- **BILL-1:** plán určuje jen server z ověřeného předplatného; nejistota = Free. Dev přepínač `WON_DEV_PLAN` zůstává
  jen v development / test.
- **PRIV-1:** analytika neukládá jméno, e-mail, adresu ani id zákazníka.
- **SF-2 (nově, rozhodnutí 3):** JS na stránku ≤ 10 000 B gz (PDP, košík, kolekce / vyhledávání), každý soubor
  ≤ 10 000 B raw.

## Rozhodnuto výchozí hodnotou

- **P1 — hustší payload úrovní (zvednutí stropu 550 B)** se v MVP 7 nedělá: je to změna funkce a rezerva je 0,10
  bodu. Zůstává v dluhu s touto větou.
- **P2 — analytika: přiřazení slevy k pravidlu.** Objednávka nese u slevy název uzlu a text kandidáta. Pravidlo se
  určí podle textu (název pravidla, text úrovně, text dárku z `describe.ts`); co nesedí, jde do řádku „Ostatní
  slevy Won“. Naživo neověřeno (objednávky čekají na schválení Shopify).
- **P3 — zkušební doba** se nabízí jednou na obchod (Shopify ji počítá sám podle `trialDays`); appka ukazuje datum
  konce zkoušky z předplatného.
- **P4 — „Připravit na odinstalaci“** nemaže Won slevy ani nastavení (odinstalace je smaže sama); ukončí výprodeje
  a obnoví nativní slevy ze zálohy. Po kroku appka řekne, co zbývá udělat ručně (nic, nebo výčet).
- **P5 — vlastní vzhled (Pro)** = barvy, zaoblení a velikost písma jako CSS proměnné + pole vlastního CSS, které se
  vždy obalí kořenem bloku (SEC-3). Bez vlastního HTML a JS.
- **P6 — ceny na kartách** ukazují jen první úroveň sady („od 3 ks −10 %“ / „od 3 ks −5 Kč za kus“) a jen u
  produktů, kde ji ochrana marže nesníží (bez nákupní ceny a strop ≥ sleva, nebo marže vypnutá). Jinak nic.
  Tak karta nikdy neslíbí víc než pokladna bez výpočtu ceny na kartě.

## Kontrakty (zafixované před implementací)

**M1 — billing (`app/lib/billing.server.ts`, vzor Won Toasts).**
- `PRO_PLAN = {name: "Won Discounts Pro", amount: "29.00", currency: "USD", interval: "EVERY_30_DAYS",
  trialDays: 14}`; `test: true` mimo produkci.
- Prisma `ShopEntitlement {shop @id, plan "free"|"pro", subscriptionId?, status?, trialEndsAt?, checkedAt,
  updatedAt}`. `resolvePlan(shop)`: dev přepínač → jinak řádek `plan = "pro"` a `status = "ACTIVE"` → Pro, vše
  ostatní Free.
- `reconcilePlan(admin, shop)`: `currentAppInstallation.activeSubscriptions` → zapíše řádek; při změně plánu
  spustí resync (sync už řeší `appliedPlan` ≠ plán). Volá ji Tarif (loader), návrat z potvrzení, webhook
  `app_subscriptions/update` (`/webhooks/app_subscriptions/update`, idempotentní) a scheduler `billing.reconcile`
  (denně, obchody s Pro).
- Akce Tarifu: `intent = subscribe` → `appSubscriptionCreate` → `confirmationUrl` (přesměrování `_top`);
  `intent = cancel` → `appSubscriptionCancel` → Free. `returnUrl = <app>/app/plan?billing=return`.
- `PlanScreen`: Free (co platí), Pro (cena, zkouška, co přidá), stav (`Zkouška do …` / `Pro` / `Free`), tlačítka
  „Vyzkoušet Pro na 14 dní zdarma“ a „Zrušit Pro“ s větou, co se stane při zrušení (A6).

**M2 — downgrade (A6).** Beze změny logiky (gate + `campaignsFinishing` + doběh výprodejů z MVP 5–6). Nově:
po `cancel` Tarif vypíše, co doběhne (běžící kampaně a výprodeje jménem) a co přestalo platit (`explainGate`).

**M3 — „Připravit na odinstalaci“ (A7).** `app/lib/integration/uninstall-prep.server.ts`:
`planUninstallPrep(ctx)` → `{outlets: {id, name}[], natives: {id, title}[]}` (co se stane, bez zápisu);
`runUninstallPrep(ctx)` → ukončí každý běžící výprodej (`endOutletRun`, ceny ze zálohy), obnoví každou nativní
slevu ze zálohy (stávající undo), vrátí `{ended, restored, failed: {what, detail}[]}`. Tarif: sekce s výčtem a
jedním tlačítkem; výsledek jako seznam.

**M4 — analytika.**
- Prisma `OrderDiscountFact {id, shop, orderId, createdAt, currency, subtotalMinor, discountMinor, parts Json,
  gifts Int, outletItems Int, cancelledAt?}` + `@@unique([shop, orderId])`. `parts` = `[{key, kind: "rule" |
  "tier" | "gift" | "shipping" | "other", amountMinor}]`. Retence 400 dní (`history.prune`), `shop/redact` maže.
- `app/lib/analytics/order-facts.ts` `orderFactFromWebhook(payload, config)` (čistá funkce, P2);
  `/webhooks/outlet` navíc uloží fakt (`orders/create`) a označí storno (`orders/cancelled`) — **odběr není v toml**.
- `loadAnalytics(ctx, {days: 30})` → `AnalyticsView {available, range, free: {orders, discountedOrders,
  discountCost, averageOrder}, pro?: {rules: {name, orders, cost, revenue}[], gifts, outlet: {name, sold,
  quota}[], marginCapped}, series: {day, cost, revenue}[]}` — částky v měně obchodu; objednávky v jiné měně se
  počítají zvlášť a obrazovka to řekne.
- Obrazovka `/app/analytics` („Přehledy“): Free čísla + sloupcový graf; Pro tabulka pravidel (Free zamčeno amber);
  bez přístupu k objednávkám poctivý stav „Čísla začnou přibývat, až Shopify appce povolí objednávky“. Přehled:
  karta se třemi čísly a odkazem.

**M5 — aktivace objednávek jedním krokem (rozhodnutí 1 a 5).** `scripts/activate-orders.mjs`: dry-run vypíše diff
`shopify.app.toml` (scope `read_orders` + **jeden** odběr `orders/create`, `orders/cancelled`, `refunds/create` →
`/webhooks/outlet`; route krmí kvótu výprodeje i fakta analytiky, téma se neodebírá dvakrát), `--live` ho zapíše a
nechá kopii. Unit test nad textem skutečného toml. Do toml se v MVP 7 **nezapisuje**.

**M6 — onboarding kroky 4–5.** Krok 4: recepty s předvyplněnou hodnotou (stávající `RecipeGrid`) přímo v
onboardingu; uložení první slevy posune na krok 5. Krok 5 „Hotovo“: checklist ze skutečných signálů (sleva běží,
embed zapnutý, tabulka na PDP přidaná, vyzkoušený košík) s jedním tlačítkem u každého nesplněného bodu.
`config.onboarding.step` 1–5.

**M7 — vzhled Pro + texty + návod pro AI.**
- Config `storefront.custom?: {vars: {accent?, text?, background?, border?, radius?, fontScale?}, css?: string}`
  (sanitizer: barvy `#rgb` / `#rrggbb`, radius 0–32 px, fontScale 80–140 %, CSS ≤ 4 000 znaků, bez `@import`,
  `url(`, `expression(`, `</style`, `<`, `}` mimo páry). Gate: Free `custom` neposílá.
- Storefront config `appearance: {preset, vars?, css?}`; `css` už obalené selektorem kořene
  (`core/discounts/scope-css.ts` `scopeCss(css, root)`); Liquid ho vypíše do `<style>` bloku, proměnné jako
  `style` kořene.
- Texty storefrontu: editor `locales[cs|sk|en]` (klíče extension, prázdné = výchozí), limit 500 znaků / text.
  Uložení odmítne storefront config nad 128 000 B (dnes jen selhaný krok syncu).
- Návod pro AI: `docs/reference/storefront-contract.generated.md` (datový kontrakt bloku, eventy
  `won-discounts:*`, CSS proměnné, DOM markery, příklad) generovaný z kódu + tlačítko „Zkopírovat zadání pro AI“
  ve Vzhledu (Pro).

**M8 — ceny podle množství na kartách (BETA, rozhodnutí 4, P6).**
- Config `storefront.cardPrices: boolean` (výchozí false, BETA štítek v adminu); storefront config `cards?: 1`.
- Horizon: app blok `card_tiers` (Liquid, bez JS) pro kartu produktu (`@app` v `_product-card`); admin dá deep
  link „Přidat do karty produktu“ a pozná, že blok v šabloně je.
- Dawn (a témata bez `@app` v kartě): embed na šablonách `collection` a `search` vypíše JSON `{handle: text}` pro
  produkty stránky a nahraje `won-discounts-cards.js` (jen tam), který text vloží pod cenu karty
  (`a[href*="/products/<handle>"]` → nejbližší karta; vlastní marker `data-won-discounts-card`).
- Text počítá jeden Liquid snippet `won-card-tier` (sdílený blokem i embedem). Property test: text karty ≤ to, co
  dá `planCart` pro první úroveň (P6).
- Perf contract: stránka kolekce / vyhledávání = embed + cards ≤ 10 000 B gz.

**M9 — docs corpus.** `scripts/gen-docs.ts` + `docs/index.generated.md` + `docs/dist/corpus.jsonl`
(`{slug, layer, feature, min_plan, lang, title, summary, keywords, body}`), drift test (generované = commitnuté),
corpus test (každý `.md` má záznam, odkazy vedou na existující slug). Nové stránky: billing, downgrade,
odinstalace, přehledy, vlastní vzhled, texty, ceny na kartách.

**M10 — nasazení (A13) a Postgres.** `Dockerfile` (kontext = root repa, staví s devDependencies vč. Rustu pro
funkci jen když je potřeba pro build appky — funkce se nasazuje přes CLI, ne image), `fly.toml`,
`docker-compose.yml` (Postgres lokálně), `DEPLOY.md` (kroky, tajné proměnné jménem, předpoklad **jedné instance**:
zámky, fronty a scheduler jsou per proces). Postgres: `prisma/postgres/schema.prisma` + migrace generovaná proti
lokálnímu Postgresu, `npm run test:postgres` (migrace + integrační testy souběžného uložení a claim indexu na
Postgresu v Dockeru). SQLite zůstává pro dev a unit testy.

**M11 — BFS kontrola.** `docs/won-discounts/bfs-check.md`: požadavky Built for Shopify, u každého stav (splněno s
důkazem / nejde ověřit bez nasazení / nesplněno) a co jde změřit lokálně (velikost JS, žádná chyba v konzoli
storefrontu v E2E, webhooky compliance, scopes minimum, admin v harnessu 390/1440).

**M12 — dluh.** Formát ceny v bloku podle tématu (kód měny na Dawnu), mezera pod „Zaplatit“ na Horizonu (V1),
`eslint` node globals. Přehled: „slevy platí v pokladně (poslední ověření)“ z posledního úspěšného syncu.

## Úkoly po vrstvách (každá vrstva: testy červeně → kód → celý `test:unit` → commit)

1. **Billing** M1 + M2 (core nic; Prisma migrace; server; Tarif; webhook; scheduler; harness; cs + en; docs).
   → **zastávka pro Ondřeje**: schválit testovací předplatné (přesný krok) — pokračuju dalšími vrstvami.
2. **Odinstalace** M3. 3. **Analytika** M4 + M5. 4. **Onboarding + Přehled** M6, M12 (Přehled).
5. **Vzhled Pro, texty, návod pro AI** M7 (core → sync → storefront → admin). 6. **Karty** M8 + perf contract.
7. **Docs corpus** M9. 8. **Docker, Fly, Postgres** M10. 9. **BFS** M11.
10. Brána → živé E2E Free + Pro Horizon + Dawn (nové profily: `cards`, `appearance`; billing naživo po schválení) +
    regrese MVP 1–6.1 → vizuální QA 390 + 1440 → audit `audits/audit-mvp7.md` → self-audit → roadmapa `Shipped` →
    checkpoint → commit + push → závěrečný report.
