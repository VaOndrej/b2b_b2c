# Won Discounts — technický, bezpečnostní a testový audit, 2026-10-26

Rozsah: `apps/won-discounts` (React Router app, Rust funkce `won-discounts-engine`, theme extension
`won-discounts-storefront`) a sdílené balíčky, na kterých stojí (`@won/app-kit`, `@won/core`). Stav `main` @ `b041d1be`.
Inline, bez subagentů. Produkční kód se neměnil; přibyly jen testy (oddíl E).

Nálezy, které produkční kód zatím nesplňuje, mají regresní test s `todo`: node:test je spustí a vypíše selhání
(`⚠ … # todo`), ale brána kvůli nim nespadne. Spolu s opravou se `todo` smaže a test od té chvíle hlídá.

## A. Shrnutí

- **Nasazení blokuje jeden nález: SEC-01.** Sdílená továrna `createShopifyApp` loguje v každém prostředí na úrovni
  Debug i HTTP požadavky. V logu pak skončí client secret aplikace, session token obchodníka a Admin API access token
  shopu. Potvrzeno testem přes skutečnou produkční cestu (token exchange + `admin.graphql`). Týká se všech čtyř aplikací
  monorepa včetně šablony, ne jen Won Discounts.
- **Billing (BILL-01, BILL-02):** stav tarifu se při doručení webhooků mimo pořadí rozjede se Shopify. Při víc než
  150 platících shopech navíc denní kontrola nestíhá a platící shopy přechodně padají na Free. Obojí potvrzeno testem.
- **Veřejný endpoint košíku (SEC-03)** funguje jako neomezený orákl na hádání slevových kódů: 50 000 pokusů za 138 ms,
  ani jeden neomezený.
- **Závislosti (SEC-02):** `react-router` 7.13.0 má známé advisories pro framework mód, mj. neautentizovaný DoS.
  Oprava je v rámci `^7`.
- **GDPR (DATA-01):** `shop/redact` nemaže tabulku `CombinationCheck`.
- **Testy jsou rozsáhlé a zelené** (3 882 testů, 0 selhání), ale **CI je nespouští** (TEST-01) a CI na `main` je
  červené u posledních 5 pushů kvůli won-toasts. Brána tedy existuje jen lokálně.
- Logika slev, peněz a funkce je pečlivá: celočíselné minor units, parita Rust ↔ TS na fixturách a náhodných košících,
  escapování na storefrontu, validace vstupů app proxy, izolace shopů přes session nebo podpis proxy. Žádná chyba ve
  výpočtu slev se nenašla.
- **Neověřeno:** živé E2E (dev store), chování za skutečnou Shopify app proxy (rate limiting na straně Shopify),
  skutečné doručování webhooků. Podrobnosti v oddílu H.

## B. Bezpečnostní nálezy

| ID | Sev. | Místo | Problém | Důkaz | Reprod. | Test | Stav |
|---|---|---|---|---|---|---|---|
| SEC-01 | **Critical** | `packages/app-kit/src/shopify.server.ts:31` (`logger: { level: LogSeverity.Debug, httpRequests: true }`, komentář „TEMP debug“) | `@shopify/shopify-api` při `httpRequests` + Debug loguje tělo každého `fetchRequestFactory` požadavku a `requestParams` GraphQL klienta. Token exchange posílá v těle `client_secret` a `subject_token`, GraphQL hlavičky nesou `X-Shopify-Access-Token`. | Test: client secret v logu 1×, session token 2×, access token 1×. Knihovna: `shopify-api/dist/esm/lib/utils/fetch-request.mjs:8-15`, `lib/auth/oauth/token-exchange.mjs:18-35`, `lib/clients/common.mjs:43-50` | Confirmed (lokálně, podvržený `fetch`) | `apps/won-discounts/tests/security-logging.test.ts` | **Opraveno** (2026-10-26, test bez `todo`, brána zelená). Schváleno: `httpRequests: false` vždy, `Debug` jen při `NODE_ENV=development`, jinak `Error`; pravidlo do `docs/nova-aplikace.md`. Rotace ne: nic nebylo nasazené, výpis šel jen do lokálního terminálu. |
| SEC-02 | High | `react-router` / `@react-router/*` 7.13.0 (lockfile) | Advisories mimo jiné: GHSA-8x6r-g9mw-2r78 (DoS přes `__manifest`), GHSA-rxv8-25v2-qmq8 (DoS v single-fetch), GHSA-chx6-hx7r-mcp5 (DoS přes route matching), GHSA-49rj-9fvp-4h2h (turbo-stream, „Unauth RCE“), open redirecty. Dál `express` řetězec z `@react-router/serve`: `proxy-addr` (critical), `body-parser`, `compression`, `path-to-regexp`. | `npm audit --omit=dev`: 72 položek (2 critical, 64 high) za celé monorepo. Většina je build tooling (`@graphql-codegen`, `@graphql-tools`, `@shopify/shopify_function` CLI), ne runtime aplikace. | Potential: verze je zranitelná, exploit jsem nezkoušel | — | **Opraveno** (2026-10-26): `react-router` a `@react-router/*` 7.13.0 → 7.18.4 (rozsah `^7.18.4` ve všech aplikacích, `app-kit` i šabloně, jediná instance v lockfilu), `proxy-addr` 2.0.8, `body-parser` 1.20.9, `compression` 1.8.2, `path-to-regexp` 0.1.13. Runtime řetězec bez advisories. Ověřeno: won-discounts `test:unit`, typecheck, lint, build; typecheck a build won-toasts, b2b-companion a šablony; won-toasts `test:unit` má stejná 4 selhání jako před změnou. GHSA-49rj platí i pro framework mode bez RSC, ale jen při existující prototype pollution v aplikaci. Vědomě odloženo: zbylých 63 položek `npm audit --omit=dev` (mj. critical `shell-quote`) je v build toolingu (`@graphql-codegen`, `@shopify/shopify_function`). |
| SEC-03 | Medium | `app/lib/integration/cart-plan.server.ts` `runCartPlan` + `takeRead`; `parseCartPlanRequest` (až 25 kódů) | App proxy počítá plán s kódy, které pošle prohlížeč, a odpověď `saved` odliší správný kód od špatného. Limit 30/min počítá jen požadavky, které čtou Shopify; nacachované odpovědi limit nemají. Výsledek je neomezený orákl na hádání kódů mimo throttling pokladny Shopify. Hashe kódů na storefront nejdou (ověřeno), útok je tedy jen online. | Test: `saved` 0 vs 15 000. Lokální sonda: 2 000 požadavků × 25 kódů, 0× `CartPlanRateLimited`, 2 čtení Shopify. | Confirmed (unit úroveň). Jestli Shopify proxy sama něco omezuje, neověřeno. | `tests/integration/cart-plan-code-oracle.test.ts` | **Opraveno** (2026-10-26, test bez `todo` + 2 hlídací testy, brána zelená): rozpočet `CART_PLAN_CODES_PER_MINUTE = 50` různých kódů (bez ohledu na velikost písmen) na shop a minutu, počítá se i pro nacachované odpovědi; kód už zadaný v okně se nepočítá znovu. Nad rozpočtem `CartPlanRateLimited` → 429, panel bez nápovědy, pokladna beze změny. Varianta „jen `applicable` kódy z `/cart.js`“ zamítnuta (příznak posílá prohlížeč). |
| SEC-04 | Low | `app/lib/integration/cart-plan.server.ts` `takeRead` (a obdobně `card-tiers.server.ts`) | Limit 30 čtení za minutu je na shop, ne na klienta. Kdokoli s náhodnými ID variant ho vyčerpá a skuteční zákazníci shopu pak minutu nedostanou nápovědu v košíku. Pokladnu to neovlivní, selhání je bezpečné (fail closed). | Chování popsané a otestované v `cart-plan.test.ts` „audit P2…“ | Confirmed (záměrný design) | existující | Ponechat, zvážit limit na IP |

Ověřeno bez nálezu: autentizace admin rout (`authenticate.admin` všude, shop jen ze session), HMAC webhooků
(`authenticate.webhook`, existující testy se špatným HMAC), podpis app proxy, izolace shopů (cache a limity podle shopu
z podpisu), dev harness z produkčního buildu vyřazený (build + contract test), escapování storefront HTML (`esc`,
`textContent`), handle v `card-tiers` bez možnosti injekce do vyhledávacího dotazu
(`/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,254}$/u`), dárky jen pro varianty z tieru a jen 1 kus na tier
(`extensions/won-discounts-engine/src/input.rs:386-390`, `src/engine/plan.rs:2293-2312`). V historii gitu nejsou
tajemství (grep na `shpat_/shpss_/shpca_/shppa_` + 32 hex, `sk-ant-`, `AKIA`, privátní klíče: 0 výskytů);
`shpat.md` je v `.gitignore` a není trackovaný.

## C. Funkční a spolehlivostní nálezy

| ID | Sev. | Místo | Problém | Důkaz | Reprod. | Test | Stav |
|---|---|---|---|---|---|---|---|
| BILL-01 | High | `app/lib/billing.server.ts` `recordSubscriptionUpdate`; `app/lib/jobs/scheduler.server.ts` `runBillingReconcileOnce` (`where: { plan: "pro" }`) | Webhook `app_subscriptions/update` přepíše řádek tarifu bez ohledu na to, které předplatné a jak čerstvá změna to je (`updated_at` se neporovnává). Shopify pořadí doručení negarantuje a neúspěšné doručení opakuje až 48 h. (a) Pozdní CANCELLED starého předplatného po ACTIVE nového shodí platící shop na Free. Denní kontrola řádky Free nečte, takže chyba vydrží, dokud obchodník neotevře Nastavení nebo Tarif. Pokladna mezitím po nejbližší synchronizaci přestane uplatňovat Pro funkce. (b) Pozdní ACTIVE po CANCELLED zapne Pro bez platby, opraví ho až denní kontrola. | Test: (a) `free` místo `pro`, kontrola řádek neopraví; (b) `pro` místo `free` | Confirmed (logika); reálný výskyt mimo pořadí nepozorován | `tests/lib/billing-audit.test.ts` | **Opraveno** (2026-10-26, varianta b, 3 testy bez `todo`, brána zelená): nový sloupec `ShopEntitlement.eventAt` (migrace SQLite `20261026120000`, Postgres `0008`); webhook ignoruje událost starší než řádek a ne-ACTIVE událost jiného předplatného, než je uložené ACTIVE; `reconcilePlan` zapisuje `eventAt = now`; denní kontrola čte i řádky se `subscriptionId`. Navíc (opraveno, `confirmSubscriptionUpdate`): webhook po zápisu na pozadí zavolá `reconcilePlan` (offline session), aby posun hodin ani chybějící `updated_at` nerozhodovaly. |
| BILL-02 | Medium | `app/lib/jobs/scheduler.server.ts` (`BILLING_RECONCILE_BATCH = 50`, `everyMs: 24 h`); `billing.server.ts` (`ENTITLEMENT_STALE_MS = 72 h`) | Denní kontrola projde 50 nejstarších Pro řádků, ale potvrzení vyprší po 72 h. Při víc než 150 platících shopech část řádků zastará dřív, než na ně kontrola dojde, a `storedPlan` pro ně vrací Free. Synchronizace v tom okně vyřadí Pro z pokladny, další kontrola ho vrátí. | Test: 200 Pro shopů, v hodině 73: 50 shopů na Free | Confirmed | `tests/lib/billing-audit.test.ts` | **Opraveno** (2026-10-26, test bez `todo` přes skutečnou úlohu `appTasks` + `runDueTasks`, hlídá i počet čtení ze Shopify; brána zelená). Schváleno: `billing.reconcile` každou hodinu, max 50 řádků s `checkedAt` starším než 20 h (kapacita 3 600 Pro shopů, minutové úlohy zdrží max ~15 s). Test volá kontrolu po hodinách jako skutečný plánovač. |
| DATA-01 | Medium | `app/lib/config.server.ts:487` `deleteShopData` | GDPR `shop/redact` nemaže `CombinationCheck`, přestože schéma slibuje „erased with the shop“. Zůstanou scénáře a produkty, které použily (bez osobních údajů zákazníků). | Test: řádek po `deleteShopData` zůstal. Strukturální test: ze všech modelů s polem `shop` chybí jen `CombinationCheck`. | Confirmed | `tests/lib/shop-redact-coverage.test.ts` | **Opraveno** (2026-10-26, oba testy bez `todo`, brána zelená): `deleteShopData` maže i `CombinationCheck`. |
| REL-01 | Low | `packages/app-kit/src/webhooks.ts` `createScopesUpdateAction` | `payload.current as string[]` bez kontroly: podivný payload vyhodí výjimku a vrátí 500, Shopify pak doručení opakuje. Bez bezpečnostního dopadu. | revize kódu | Potential | — | Doporučení |

Mimo nálezy: konfigurace a synchronizace mají zámek na shop a optimistické verze (F12). Zámek, cache i plánovač žijí
v procesu, takže aplikace smí běžet v jediné instanci. To je zdokumentované (`DEPLOY.md` „One instance“) a vynucené
(`fly.toml` jeden stroj, `railway.json` `numReplicas: 1`). Při škálování na víc instancí se tyto předpoklady rozbijí.

## D. Stávající testy

Sady a příkazy:

| Sada | Příkaz | Co ověřuje | Baseline (před změnami) |
|---|---|---|---|
| node (unit, integrace s SQLite z migrací, contract, UI model, docs) | `npm run test:unit` krok 1 (`tsx --test tests/**/*.test.ts scripts/**/*.test.mjs`) | logika appky, webhooky, billing, sync s falešným Shopify, contract testy storefrontu a funkce | **1 992 pass / 0 fail / 0 skip** |
| Rust funkce | `npm run test:unit` krok 2 → `cargo test` | engine natively, všechny fixtury | **107 pass, 1 ignored** |
| Wasm + parita | `npm run test:unit` krok 2 → `vitest` | fixtury proti input query a schématu, Wasm běh, parita Rust ↔ TS na fixturách a seeded náhodných košících | **720 pass (6 souborů)** |
| `@won/core`, `@won/testing` | `npm run test:packages` (kořen) | doménový engine | **1 009 + 54 pass** |
| Postgres | `npm run test:postgres` | migrace na Postgresu | Not Run (vyžaduje Postgres) |
| E2E (Playwright, živý dev store) | `npm run test:e2e`, `test:e2e:preview` | pokladna, storefront Horizon/Dawn, admin | **Blocked**: potřebuje běžící `shopify app dev`, dev store a zápisy do něj, na které nemám „go“ |

Dobře pokryté: výpočet slev (parita dvou nezávislých implementací + náhodné košíky), peníze v minor units, rozpočty
instrukcí funkce, webhook HMAC a idempotence, izolace shopů, cache a limity app proxy, zotavení při přesunu nativních
slev, vyřazení dev harnessu z buildu, sestavení testovací DB z commitnutých migrací.

Slabá místa:
- **TEST-01 (High, proces):** `.github/workflows/ci.yml` nespouští `test:unit`, `lint` ani `cargo` pro won-discounts.
  Instaluje jen Node, ne Rust, a Prisma klienta generuje jen pro tři jiné aplikace. 2 819 testů won-discounts tak běží
  jen lokálně. CI je navíc na `main` červené u posledních 5 pushů (`won-toasts test:unit`, běh 39228030428), takže ani
  to, co v CI je, nic nehlídá.
  **Stav (2026-10-26):** opraveno pro won-discounts: samostatný CI job `won-discounts` (Rust z `rust-toolchain.toml`,
  `prisma generate`, `test:unit`, `lint`). Červený krok won-toasts (chybí Postgres v CI) je podle rozhodnutí mimo rozsah,
  job `static` proto zůstává červený.
  Při zavedení jobu se v CI ukázaly dvě skryté závislosti na lokálním prostředí: (1) contract testy storefrontu potřebují
  headless Chromium (krok `playwright install --only-shell chromium`); (2) výstup buildu funkce byl artefakt cargo, CLI do
  něj vkládá trampolínu (druhá paměť) a na Linuxu cargo soubor při dalším buildu nevrátí, takže `wasm-opt` v `build.mjs`
  spadl („multiple memories“). Oprava: `build.mjs` píše do `target/won-discounts-engine.wasm` (= `path` v
  `shopify.extension.toml`), artefakt cargo zůstává čistý; hlídá to nový test ve `function.contract.test.ts`.
  Mezikrok s připnutím Rustu na 1.98.1 vycházel z chybné hypotézy a je vrácený (`stable`).
- Testy proti mockům ověřují logiku jednoznačně, ale nic z nich nedoloží chování skutečné Shopify (pořadí webhooků,
  throttling proxy). Na to jsou E2E, které jsou zablokované.
- `tests/integration/cart-plan.test.ts` „audit P2“ výslovně fixuje, že nacachované odpovědi limit nemají. Je to
  správně z hlediska rozpočtu API, ale zakrývá to SEC-03.
- Existující billing testy (`tests/lib/billing.test.ts`, `tests/webhooks.billing.test.ts`) pokrývají jen webhooky
  v pořadí a jeden shop.
- `deleteShopData` se testuje výčtem modelů v testu. Nový model se proto dá snadno zapomenout (to se stalo
  u `CombinationCheck`).
- Skript `@won/core` `tsx --test tests/**/*.test.ts` jde přes `sh`, který `**` nerozbalí. Dnes je všech 109 souborů
  v hloubce 2, takže se nic nevynechává, ale soubor v hlubší složce by se tiše přeskočil. Riziko Low.

## E. Přidané testy

| Soubor | Co ověřuje | Proč |
|---|---|---|
| `apps/won-discounts/tests/security-logging.test.ts` | Skutečná cesta `createShopifyApp` → `authenticate.admin` (podepsaný session token) → token exchange → `admin.graphql` s podvrženým `fetch` a zachycenou konzolí. Kontrolní test ověří, že scénář proběhl. Tři `todo` testy hlídají, že client secret, session token a access token nejsou v logu. | SEC-01. Bez testu by se „TEMP debug“ vrátil při každé změně továrny. |
| `apps/won-discounts/tests/lib/shop-redact-coverage.test.ts` | Ze `schema.prisma` vezme všechny modely s polem `shop` a ověří, že je `deleteShopData` maže (strukturálně). Behaviorálně ověří smazání `CombinationCheck` a zachování jiného shopu. | DATA-01, a hlavně ochrana proti dalšímu zapomenutému modelu. |
| `apps/won-discounts/tests/lib/billing-audit.test.ts` | Kontrolní test: webhooky v pořadí → Pro. `todo`: pozdní CANCELLED starého předplatného, pozdní ACTIVE po CANCELLED, denní kontrola opraví špatně Free řádek, 200 Pro shopů v průběhu 5 dní bez výpadku. | BILL-01, BILL-02: stav peněz a funkcí obchodníka. |
| `apps/won-discounts/tests/integration/cart-plan-code-oracle.test.ts` | Důkazní test: odpověď odliší správný kód. `todo`: hádání 25 kódů na požadavek v rámci cache musí narazit na limit. | SEC-03 |

Celkem 14 nových testů: 4 procházejí (kontroly a důkazy), 10 je `todo` (nálezy čekají na opravu). Existující testy
jsem neměnil. U SEC-01 jsem ověřil oba směry: se současnou konfigurací test hlásí 3 úniky, s doporučenou
(`level: Error`, `httpRequests: false`, dočasná kopie testu) jsou všechny 4 testy zelené. Ostatní `todo` testy jsou
ověřené jen v červeném stavu.

## F. Finální ověření

Spuštěno v `apps/won-discounts`, po přidání testů:

| Kontrola | Příkaz | Výsledek |
|---|---|---|
| Unit + integrace + contract + security (node) | `npm run test:unit` krok 1 | **Passed**: 2 006 testů, 1 996 pass, 0 fail, 0 skip, **10 todo** (= nálezy z oddílu E) |
| Rust funkce | `npm run test:unit` krok 2 (`cargo test`) | **Passed**: 107 pass, 1 ignored |
| Wasm + parita | `npm run test:unit` krok 2 (`vitest`) | **Passed**: 720/720 |
| Brána celkem | `npm run test:unit` | **exit 0** |
| Doménové balíčky | `npm run test:packages` (kořen) | **Passed**: 1 009 + 54 |
| Typecheck | `npm run typecheck` | **Passed** (exit 0) |
| Lint | `npm run lint` | **Passed**: 0 chyb, 4 varování `import/no-duplicates` (existující, `pages.server.ts`, `themes.server.ts`); nové soubory bez nálezů |
| Build | `npm run build` | **Passed** (`build/server/index.js` 2,38 MB) |
| Závislosti | `npm audit --omit=dev` (kořen) | **Failed**: 72 zranitelností (1 low, 5 moderate, 64 high, 2 critical), viz SEC-02 |
| Secret scan | `gitleaks` | **Not Run** (není nainstalovaný); náhradní grep celé historie: 0 výskytů |
| Rust advisories | `cargo audit` | **Not Run** (není nainstalovaný) |
| E2E | `npm run test:e2e`, `test:e2e:preview` | **Blocked** (živý dev store, potřebuje „go“) |
| Postgres | `npm run test:postgres` | **Not Run** (bez Postgresu) |
| CI | GitHub Actions `Static monorepo gate` | **Failed** na `main` (posledních 5 běhů, won-toasts); won-discounts v CI není |

Flaky: dva plné běhy brány (baseline a finální) daly stejný výsledek, nestabilitu jsem nepozoroval. Dodatek 2026-10-26 (oprava SEC-01): `tests/integration/margin.test.ts:609` („a loader never reads the catalogue“) jednou spadl v plné bráně (`'updating'` místo `'ready'`). Samostatně prošel 5× z 5, další plný běh byl zelený. Jde o časově citlivý test pod zátěží, ne o regresi. Nové testy
nepotřebují síť ani živý store (SQLite z migrací, podvržený `fetch`), běží do 1 s a hodí se do CI.

## G. Plán oprav

**P0, blokuje nasazení**
1. SEC-01: v `createShopifyApp` nastavit `logger.level` podle prostředí (produkce `Error`/`Warning`) a
   `httpRequests: false`. Pokud je debug potřeba, jen při `NODE_ENV=development`. Dopad: všechny 4 aplikace.
   U aplikací, které už běží (`b2b-companion`?), prověřit logy hostingu a **rotovat client secret a tokeny**, pokud
   tam Debug běžel.

**P1, opravit před produkcí**
2. BILL-01: ve `recordSubscriptionUpdate` ignorovat událost staršího předplatného (`admin_graphql_api_id` ≠ uložené
   ACTIVE) a událost s `updated_at` starším než poslední zapsaná. Případně webhook použít jen jako spouštěč
   a zavolat `reconcilePlan` (zdroj pravdy je `activeSubscriptions`). Denní kontrola má číst i řádky, které změnil
   webhook nebo mají `subscriptionId`, ne jen `plan = "pro"`.
3. BILL-02: dávku kontroly navázat na počet Pro shopů (např. všechny řádky s `checkedAt` starším než 24 h, po
   dávkách v rámci jednoho běhu), aby každý řádek dostal kontrolu dřív než za 72 h.
4. SEC-02: `npm update react-router @react-router/dev @react-router/node @react-router/serve @react-router/fs-routes`
   na verzi mimo rozsah advisories (dnes `6.0.0 – 7.18.1`) v rámci `^7` + `npm audit fix` pro runtime řetězec (express/body-parser/compression/proxy-addr).
   Potom celá brána.
5. TEST-01: do CI přidat job pro won-discounts (Rust toolchain + `wasm32-unknown-unknown`, `prisma generate`,
   `npm run test:unit -w won-discounts`, `npm run lint -w won-discounts`) a opravit červený won-toasts krok.

**P2, důležité**
6. SEC-03: kódy z prohlížeče započítávat do limitu shopu i u nacachovaných odpovědí, nebo omezit počet kódů na to, co
   unese košík Shopify. Případně plánovat jen s kódy, které Shopify v `/cart.js` označil jako `applicable`.
7. DATA-01: přidat `db.combinationCheck.deleteMany({ where: { shop } })` do `deleteShopData`.

**P3, volitelné**
8. REL-01: kontrola tvaru `payload.current` ve `scopes_update`.
9. `@won/core` test skript: glob předat v uvozovkách (jako `scripts/run-unit-tests.mjs`).
10. SEC-04: limit čtení i na klienta (IP z `X-Forwarded-For` od Shopify proxy), ne jen na shop.
11. Nainstalovat `gitleaks` a `cargo-audit` a zařadit je do CI.

## H. Zbytkové riziko

- **Živá pokladna a storefront (E2E):** neběželo. Potřeba `shopify app dev` proti dev storu a tvoje „go“ na zápisy
  (seed produktů, slevy). Bez toho není ověřeno, že nasazená funkce dává v pokladně totéž co testy. Poslední živý běh je
  v commitu `8b000440` (zásuvka košíku, Horizon + Dawn).
- **Shopify app proxy:** nevím, jestli Shopify sama omezuje četnost požadavků na proxy. To určuje reálnou závažnost
  SEC-03 a SEC-04. Ověřit lze jen měřením na dev storu.
- **Webhooky mimo pořadí:** BILL-01 je potvrzený v logice. Skutečné pořadí doručení jsem nepozoroval a billing naživo
  dosud neproběhl (čeká na schválení testovacího předplatného).
- **SEC-02:** zranitelnost verzí plyne z advisories, exploit jsem nezkoušel. Applicability RCE advisory pro
  non-RSC režim neověřena.
- **Postgres:** `test:postgres` neběžel (lokálně není Postgres). Produkce podle `schema.prisma` používá SQLite.
- **Skenery:** `gitleaks` a `cargo-audit` nejsou nainstalované (Not Run), nahradil je ruční grep historie a ruční
  revize 53 crates v `Cargo.lock` (jediná přímá závislost `shopify_function` 2.2.0).
- **Rozsah revize:** do hloubky jsem prošel autentizaci, webhooky, billing, app proxy, storefront HTML sinky, dárky
  a kódy ve funkci a peníze (`money.rs`). Synchronizační vrstvu (`app/lib/sync`, ~6 000 řádků), přesun nativních slev
  a výprodej jsem prošel jen na úrovni návrhu a existujících testů.
