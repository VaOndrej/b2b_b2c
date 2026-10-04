# Won Discounts — audit MVP 7 (Dotažení), 2026-10-04

Rozsah: `git log 70ecdd0..HEAD` + vrstvy MVP 7 commitnuté před uzavřením 6.1 (`744868a`, `c433af3`, `30ec0a3`).
Plán `docs/plans/2026-10-04-won-discounts-mvp7.md` (M1–M12, P1–P6). Postup podle `.claude/agents/won-auditor.md`
(findings-first, důkaz v kódu), inline bez subagenta.

## Findings

| # | Sev. | Nález | Důkaz | Stav |
|---|---|---|---|---|
| A1 | **P1** | Řádek na kartě produktu nesl jako text komentáře, kterými Shopify obaluje výstup app snippetu (`<!-- BEGIN app snippet: won-card-tier -->Od 2 ks −10 %<!-- END app snippet -->`). Contract testy to nechytily (Liquid se v nich nevykonává). | živé E2E `cards` Free ✘ Horizon ✘ Dawn; `blocks/won_discounts_embed.liquid`, `blocks/card_tiers.liquid` | **opraveno** `95d8588` (text mezi komentáři) + test; E2E ✓ ✓ |
| A2 | P2 | Text Tarifu jmenoval `WON_DEV_PLAN` → řetězec by se dostal do produkčního bundlu (dev přepínač má být z buildu pryč beze stopy). | `tests/contracts/dev-harness.contract.test.ts` „must not contain the dev-only plan override“ ✘ | **opraveno** `744868a` (text bez názvu proměnné) |
| A3 | P2 | `usePlanDatabase` vypadalo pro lint jako React hook na nejvyšší úrovni. | `npm run lint` | **opraveno** (`setPlanDatabase`) |
| A4 | P2 | Health check ve `fly.toml` mířil na `/won-discounts/health`, která ověřuje podpis app proxy → Fly by stroj považoval za nezdravý. | `app/routes/won-discounts.health.tsx` (`authenticate.public.appProxy`) | **opraveno** `c433af3`: `/healthz` bez ověření, ověřeno v kontejneru (200) |
| A5 | P2 | Repo nemá kořenový `.dockerignore` → `COPY . .` by do image vzal `.env`, `dev.sqlite`, `.git`. | kořen repa (mimo povolené cesty) | **opraveno** `apps/won-discounts/Dockerfile.dockerignore`; v image ověřeno, že nejsou |
| A6 | P2 | Jeden webhook `orders/create` nelze odebírat dvakrát; první návrh aktivace měl dva odběry. | `scripts/activate-orders.mjs` | **opraveno před commitem**: jeden odběr → `/webhooks/outlet`, route krmí kvótu i analytiku |
| A7 | P2 | Přiřazení slevy k pravidlu v analytice jde podle textu slevy v objednávce (název pravidla / text úrovně / „Dárek zdarma“). Přejmenované pravidlo a cizí slevy spadnou do „Ostatní“. Naživo neověřeno (objednávky čekají na schválení). | `app/lib/analytics/order-facts.ts` (P2 plánu) | přijato, řečeno v nápovědě (`concepts/reports.md`) |
| A8 | P2 | Řádek karet přes embed pokrývá jen prvních 50 produktů první stránky a vkládá se skriptem po načtení (posun layoutu). | `blocks/won_discounts_embed.liquid`, `assets/won-discounts-cards.js` | přijato jako BETA; blok do karty (Horizon) nemá ani jedno; BFS dokument |
| A9 | P2 | Rezerva JS na stránce produktu je 14 B (10 226 z 10 240 B). | `perf-budget.contract.test.ts` | přijato (karty jdou na kolekci, ne na PDP) |
| A10 | P3 | Vlastní vzhled na Free gate jen tiše odřízne (není v `stripped`, Přehled ho nevypíše mezi „neplatí ve Free“). | `plan-gate.ts` | přijato (jen vzhled, ne pokladna; Vzhled ho ukazuje zamčený) |
| A11 | P3 | Editor textů nehlídá, že merchant ponechal části ve složených závorkách. | `model/appearance.ts` `readAppearanceExtras` | přijato; nápověda u pole |
| A12 | P3 | Tržby u slev v Přehledech se mezi řádky překrývají (objednávka se dvěma slevami je v obou). | `analytics.server.ts` `loadAnalytics` | přijato; věta pod tabulkou |
| A13 | P3 | Plán Pro vyprší, když ho Shopify 72 h nepotvrdí (denní reconcile bez offline session). | `billing.server.ts` `ENTITLEMENT_STALE_MS` | přijato (BILL-1: nejistota = Free); Tarif ho při otevření obnoví |
| A14 | P3 | Image má 2,33 GB (celý workspace s devDependencies). | `Dockerfile` | přijato (A13: připravit, nenasazovat) |
| A15 | P3 | `scripts/make-postgres-schema.mjs` a `test-postgres.mjs` volají `npx prisma` s vlastním `--schema`. | pravidlo repa (npm skripty) | přijato: npm skripty neumí druhé schéma |

0 × P0. P1 a opravitelné P2 opravené s testy.

## Plán vs. skutečnost (co je jinak nebo chybí)

- **M4**: Pro tabulka má cenu a tržby po slevách, počet dárků a kusů ve výprodeji. **Chybí** „výprodej prodáno X
  z Y“ po jednotlivých výprodejích (to je v modulu Výprodej) a zásahy marže z objednávek (objednávka je nenese).
- **M6**: checklist „Hotovo“ má web, první slevu a odkaz na Vyzkoušet košík. **Chybí** signál „tabulka na PDP
  přidaná“ a „košík vyzkoušený“ (nikde se neukládá).
- **M7**: proměnné vlastního vzhledu jsou 4, které bloky opravdu čtou (zvýraznění, linky, podklad, zaoblení);
  barva textu a velikost písma jdou vlastním CSS.
- **M8**: Horizon i Dawn dostávají řádek automaticky přes embed; blok do karty je volitelný (deep link). Jestli
  karta Horizonu dá bloku appky `closest.product`, **naživo ověřeno není** (blok se do šablony nevkládal).
- **M12**: formát ceny v bloku podle tématu, mezera pod „Zaplatit“ na Horizonu (V1), `eslint` node globals a
  „slevy platí v pokladně (poslední ověření)“ na Přehledu **nejsou udělané** — zůstávají v dluhu.
- **P1**: hustší payload úrovní se nedělal (změna funkce při rezervě 0,10 bodu).

## Bezpečnost vlastního CSS (SEC-3)

`scopeCss` odmítá celý text při: `<`, zpětném lomítku (escapy by schovaly klíčová slova), `url(`, `image-set(`,
`expression(`, `javascript:`, `@import`, `@font-face`, `@namespace`, `@charset`, `@property`, `@keyframes`, `@layer`,
nevyvážených závorkách, pravidle bez selektoru, délce > 4 000. Každý selektor dostane kořen
`:is(.won-tiers,.won-cart,.won-cart-slot,.won-outlet)`; `:root` / `html` / `body` = kořen. Proměnné jdou jen jako
ověřené barvy a číslo. Text končí v `<style>` — bez `<` ho nejde ukončit. Testy: `scope-css.test.ts` (6),
`custom-look.test.ts` (5), živě Pro E2E (`style#won-discounts-custom`, proměnná jen na bloku, ne na `body`).
Zbytkové riziko: pravidlo může blok roztáhnout přes stránku (`position: fixed`) — je to merchantův vlastní obchod.

## Billing (BILL-1)

Plán určuje jen `storedPlan`: řádek `ShopEntitlement` s `plan = pro`, `status = ACTIVE` a potvrzením mladším než
72 h; vše ostatní Free. Zdroje: Tarif (každé načtení), webhook `app_subscriptions/update` (HMAC, idempotentní),
denní `billing.reconcile`. Selhané čtení řádek nemění. Změna plánu spouští resync. Testy: `billing.test.ts` (9),
`plan-admin.test.ts` (4, vč. downgradu A6 s doběhem kampaně), `webhooks.billing.test.ts` (4), scheduler.
**Naživo neověřeno** — čeká na schválení testovacího předplatného.

## Živé E2E (dev store, Bogus)

Doplní checkpoint MVP 7 v build logu (`runs/mvp7-A`, `runs/mvp7-B`, evidence `evidence/mvp7/`).

## Testing gaps

- Billing naživo (potvrzovací stránka Shopify, webhook, zkušební doba, zrušení).
- Analytika naživo (doručení `orders/create`), přiřazení slev k pravidlům na skutečné objednávce.
- Blok `card_tiers` v kartě Horizonu.
- Lighthouse před / po, Web Vitals adminu (až po nasazení).
- `fly deploy` (jen `docker build` + migrace a start proti lokálnímu Postgresu).
