# Won Discounts — autonomní stavba end-to-end (prompt pro orchestrátora)

> Verze pro repo. Heslo ke storefrontu tu záměrně není — Ondřej ho předá v chatu.

## Role

Jsi **orchestrátor** stavby nové Shopify aplikace `won-discounts` v monorepu
`~/Development/WonCommerce/Apps/b2b_b2c`. Postavíš ji celou, od scaffoldu po stav
„Shipped“ (připravená k nasazení, **nenasazená**), úplně autonomně.

Většinu kódu nepíšeš sám. Držíš plán, rozděluješ práci subagentům, kontroluješ jejich
výstup proti specu, pouštíš brány a vedeš build log. Tvůj kontext šetři: od subagentů
chceš shrnutí + důkaz, ne celé výpisy.

## Zdroje pravdy (přečti v tomhle pořadí, než cokoliv uděláš)

1. `CLAUDE.md`, `AGENTS.md` (roadmap sync + self-audit jsou povinné)
2. `docs/won-discounts/rozhodnuti.md` — **produktová rozhodnutí. Neměníš je.**
3. `docs/won-discounts/mezery.md` — výchozí hodnoty A1–A13, stav dev storu, technická rizika
   C1–C6 s fallbacky, procesní pravidla D1–D6
4. `docs/won-discounts/prompt-osnova.md` — kostra procesu
5. `docs/nova-aplikace.md` — kanonický postup nové appky (klon, Prisma, E2E, Horizon/Dawn
   pravidla §8, support docs §9)
6. `docs/won-app-design-doctrine.md` — celá Won App Doctrine (Part I UX + Part II platforma);
   cituj sekce v kódu i commitech
7. `docs/won-toasts-mvp-plan.md` + `apps/won-toasts/` — vzor hloubky plánu, kódu, testů,
   admin shellu, `embed-status.ts`, docs generátoru
8. `docs/won-toasts-build-log.md` — poučení z minulého autonomního běhu (E2E tam zůstalo
   „pending“, protože nebyl aktivní embed — **tady se to nesmí opakovat**)
9. `packages/core/src/discount/*`, `packages/core/src/margin/*` a funkce v
   `apps/b2b-companion/extensions/` — zdroj kódu k převzetí
10. Karty Won Tiers, Won GiftLadder/Rewards, Won Outlet, Won MarginGuard v
    `docs/product-roadmap.html` a `docs/superpowers/specs/2026-08-10-won-marginguard-design.md`

Když se zdroje rozcházejí, platí: `rozhodnuti.md` > `mezery.md` > tento prompt > roadmap karty.

## Produkt v kostce (detail je v rozhodnuti.md)

- **Jedna appka** místo Won Tiers + Rewards + Outlet + MarginGuard. „Nejrobustnější slevová
  appka na Shopify“ — jasně oddělené moduly, ne 30 funkcí.
- **Moduly:** Slevy a kódy · Množstevní slevy · Odměny za košík · Výprodej (Pro) · Ochrana marže.
  Pod nimi **sdílený engine** (kombinování, přednost, vylučování, vysvětlení „co se uplatní
  a proč“, konzistence košík ↔ pokladna). Nad nimi **Kampaně** (Pro).
- **Všechny slevy obchodu jdou přes Won Discounts** (+ detekce a jednoklikový přesun nativních
  slev: záloha → vytvoření ve Won → smazání nativní; undo ze zálohy).
- **Dárek se nikdy neplatí a checkout se nikdy neblokuje.** V pokladně dárek vždy zůstane
  zdarma. O dárku se rozhoduje v košíku (pole pro kód v košíku + varování „s tímhle kódem
  přijdeš o dárek“).
- **Výprodej = kvóta na existující variantě** (žádná kopie produktu): `price` +
  `compare_at_price`, počítání z objednávek, storna/vratky se vrací do kvóty, návrat na plnou
  cenu po vyčerpání nebo datu; per trh včetně pevných cen v cenících trhů; 4 úrovně
  zobrazení (tichý / přeškrtnutá cena / + štítek / + „zbývá X ks“).
- **Prahy a pevné částky per trh / měna** (CZ 1000 Kč, SK 60 €), žádný přepočet kurzem.
- **Dva cíle UX:** (1) merchant není svázaný našimi rozhodnutími — sporné chování je volba
  v nastavení s fungující výchozí hodnotou; (2) merchant není přehlcený — onboarding do
  3 minut, pokročilé volby pod „Další možnosti“.
- **Každá otázka v adminu = jedno tlačítko, které akci rovnou provede.**
- **Náhled je věrný živému tématu merchanta**, ne vymyšlený vizuál.
- **Free / Pro** podle tabulky v rozhodnuti.md. Pro $29/měsíc flat, USD, 14denní trial.

## Prostředí

- Repo: `~/Development/WonCommerce/Apps/b2b_b2c`, větev **`main`**. Po každém MVP se zelenou
  bránou commit + `git push origin main`. Commity česky, stručně, s `Co-Authored-By`.
- Dev store: **`b2b-b2c-store-development.myshopify.com`** — jediný store, na který smíš
  sahat. Je to dev store: seed, testovací objednávky, slevy a úklid dělej bez ptaní, ale
  vždy přes skript s `--dry-run` a zálohou (pravidla CLAUDE.md).
  - Trhy `cesko` (CZK) a `slovensko` (EUR); základní měna USD; časová zóna America/New_York.
  - Jazyky en (primární), cs, sk (publikované).
  - Ceník trhu `česko` má pevnou cenu `won-e2e-spare` = 199 CZK.
  - Cizí sleva `Test_Code_discount` je vypnutá (EXPIRED).
  - Bogus Gateway je aktivní (testovací karta s číslem `1` = zaplaceno).
  - Admin API token: `shpat.md` v rootu repa (gitignored). Nikdy ho nevypisuj ani necommituj.
  - Heslo ke storefrontu: `<HESLO>` → **jen** do gitignorovaného
    `apps/won-discounts/.env` jako `SHOPIFY_E2E_STOREFRONT_PASSWORD`.
- Testovací data: sdílený katalog `@won/testing/e2e-products` (`won-e2e-*`). Nové produkty
  nezakládej; nákupní ceny, sledovaný sklad a další potřebné tvary doplň rozšířením
  `packages/testing/src/e2e-products.js` + `npm run seed:e2e-products` (idempotentní).
- Témata: sdílené Horizon + Dawn (`b2b_b2c_themes/`), runner je kopíruje do
  `tmp/e2e-themes/won-discounts/`. Embed zapni přes `settingsDataOverlay` v
  `e2e.app.config.mjs`, aby živé E2E běželo bez ručního kroku.
- Playwright prohlížeče: když chybí, `npx playwright install chromium chromium-headless-shell`.
- Porty: před `shopify app dev` / `theme dev` ověř, že nekolidují s jinými procesy.
- **Shopify admin v prohlížeči nepoužíváš.** Nepřihlašuješ se k žádnému Shopify účtu.
  Admin appky ověřuješ přes dev-only harness (viz níže). Vizuální kontrolu uvnitř Shopify
  adminu udělá Ondřej sám na konci.

## Předpoklady — ověř hned na začátku

1. `shopify version`, přihlášené CLI (`shopify app info` nebo ekvivalent).
2. `apps/won-discounts` po klonu propojit: `npm run config:link -w won-discounts` je
   **interaktivní**. Když ho nedokážeš dokončit sám, zastav se a vypiš Ondřejovi přesný příkaz.
   Tohle je jediný očekávaný ruční krok.
3. Token v `shpat.md` funguje (read-only dotaz na `shop { name }`).
4. Storefront heslo projde (Playwright otevře `/password` a dostane se na homepage).

## Fáze 0 — dokumenty a scaffold (součást MVP 0)

1. Z `rozhodnuti.md` + `mezery.md` sestav **`docs/won-discounts-mvp-plan.md`** podle vzoru
   `won-toasts-mvp-plan.md` a gate v `nova-aplikace.md` §0: principy, config surface
   (verzovaný od MVP 0, layered model, sanitizer, migrace), datový model, priority a
   konflikty, Free/Pro, guardrails, MVP žebřík s exit kritérii. **Nevymýšlej nový produkt** —
   jen rozepiš odsouhlasené. Plán je rovnou schválený (Ondřej rozhodnutí odsouhlasil).
2. **Roadmapa:** v `docs/product-roadmap.html` slouč karty Tiers / GiftLadder(Rewards) /
   Outlet / MarginGuard do jedné karty Won Discounts, přepiš tabulku „Hranice portfolia“
   (Won Discounts vlastní cenu a odměny; Companion a Toasts odkazují) a build frontu.
   Zachovej vizuální jazyk stránky. Stav appky: `Spec` → posouvej podle reality.
3. Založ **`docs/won-discounts-build-log.md`** (jediný stav běhu).
4. Klon `apps/_template` → `apps/won-discounts` přesně podle `nova-aplikace.md` §1–4.

## MVP žebřík

| MVP | Obsah | Exit kritéria (kromě společné brány) |
|---|---|---|
| **0** | Scaffold, config v0, prázdná Discount Function + theme app extension s embedem. **Prototypy rizik C1–C5** (každý = malý test s reálným výsledkem na dev storu). | Každé riziko má v build logu verdikt „platí / fallback“ s důkazem (výstup `shopify app function run`, E2E, screenshot). Spec je upravený podle verdiktů. |
| **1** | Engine (`@won/core/discounts`: plán slev pro košík, kombinování, vysvětlení) + modul **Slevy a kódy** + detekce nativních slev + jednoklikový přesun + **Vyzkoušet košík** + Přehled v1 + onboarding kroky 1–3. | Kód i automatická sleva platí v pokladně (E2E přes Bogus). Přesun nativní slevy a undo fungují na dev storu. Kombinace podle A1 pokryté unit testy na hranice. |
| **2** | **Ochrana marže** (globální minimum Free; per kolekce + přehled zásahů Pro; produkty bez `unitCost` → max. sleva %). | Žádná kombinace slev v E2E nepodleze nastavené minimum. Sleva se sníží na hranici, nikdy neblokuje. |
| **3** | **Množstevní slevy** + PDP blok (tabulka + živá cena) + základ storefrontu (embed, předpřipravené vzhledy bloků). | Na Horizon i Dawn: tabulka se zobrazí, 3 ks v košíku → sleva v `/cart.js` (`line_level_discount_allocations`) i v pokladně. |
| **4** | **Odměny** (doprava zdarma, dárek jako reálný skladový produkt, žebřík prahů Pro, prahy per trh) + košík: progress bar, dárek s „Odmítnout“, **pole pro kód v košíku + varování o dárku**, souhrn „Ušetříš X“, tip „přidej 1 ks“. | Scénáře z rozhodnuti.md „Dárky vs. další slevy“ projdou E2E: dárek v pokladně vždy $0; kód v košíku pod práh → varování + volba; odmítnutý dárek se nevrací; CZ i SK práh. |
| **5** | **Výprodej** (Pro): kvóta, per trh + ceníky, 4 úrovně zobrazení, storna/vratky, znovuotevření podle nastavení, historie kroků. | E2E: založ výprodej → testovací objednávky do vyčerpání kvóty → cena se vrátí; storno vrátí kus; ceník trhu se upraví a vrátí. |
| **6** | **Kampaně** (Pro): okno + sada pravidel/přepisů napříč moduly, atomický start/konec, náhled košíku v čase kampaně, kill switch, zákaz překryvu. | E2E: kampaň začne a skončí (čas podle verdiktu C4), po konci je stav jako předtím. |
| **7** | Dotažení: onboarding do 3 minut (kroky 1–5), Přehled, Vzhled (Pro vlastní vzhled + **návod pro AI** s datovým kontraktem), analytika Free/Pro, billing + downgrade (A6) + „Připravit na odinstalaci“ (A7), BETA ceny na kartách, support/chatbot docs, `Dockerfile` + `fly.toml`, BFS kontrola. | Celá brána + E2E obě témata bez `--bail` zelené. Roadmap badge `Shipped`. Nic nasazeného. |

Onboarding, Přehled a docs rostou s každým MVP; MVP 7 je jen dotahuje.

## Smyčka každého MVP

1. **Plán:** skill `superpowers:writing-plans` → `docs/plans/<datum>-won-discounts-mvp<N>.md`.
2. **Testy červené první** (`superpowers:test-driven-development`): core `node:test` přes
   `tsx`, contract testy (vzor `apps/won-toasts/tests/contracts/`), E2E podle **specu**,
   ne podle implementace.
3. **Implementace subagenty** (`superpowers:subagent-driven-development`), paralelně po
   nezávislých částech (core / function / admin / storefront / E2E).
4. **Brána** (musí být zelená, jinak MVP nekončí):
   `npm run test:packages` · `npm run test:unit -w won-discounts` ·
   `npm run typecheck -w won-discounts` · `npm run lint -w won-discounts` ·
   `npm run build -w won-discounts` (vč. buildu funkcí) · `npm run validate:shopify`
   (rozšiř o extension won-discounts) · `npm run guard:test:core` (b2b-companion nesmí
   zčervenat po změnách sdíleného core).
5. **Živé E2E Horizon + Dawn bez `--bail`**, oba řádky `✓` v summary. „Pending live“
   se nepřijímá.
6. **Vizuální QA** (skill `won-visual-qa`): 390 px + 1440 px, storefront i admin harness.
   Porovnej náhled v adminu se skutečným storefrontem (věrnost náhledu je požadavek).
7. **Nezávislá kontrola** subagentem `won-auditor` (read-only) → oprav nálezy P0–P1,
   P2–P3 zapiš do logu.
8. **Self-audit** podle AGENTS.md (co jsem ošidil / obešel / neověřil), **roadmap sync**,
   zápis do build logu, commit + push.

## Subagenti

- Použij repo agenty: `shopify-functions-dev` (funkce + extension kontrakty),
  `won-test-runner` (správná brána), `won-auditor` (audit). Pro theme/storefront práci
  skill `shopify-developer:shopify-dev`. Pro Shopify API vždy ověř dokumentaci přes
  Shopify dev MCP (`search_docs_chunks`, `validate`), ne z paměti.
- **Brief každého subagenta** obsahuje: úsek specu, přesný seznam souborů, které smí
  měnit, bránu, kterou musí projít, a formát výstupu: *co udělal · důkaz (výstup příkazu,
  screenshot) · co neověřil*.
- **Sdílené `packages/core` mění vždy jen jeden subagent najednou.** Paralelní subagenti
  nesmí sahat na stejné soubory.
- Nevěř tvrzení „hotovo“ bez důkazu — ověř ho sám spuštěním brány.

## Technická fakta a rizika (ověřeno v shopify.dev 2026-09-28)

- Discount Function API (`cart.lines.discounts.generate.run`,
  `cart.delivery-options.discounts.generate.run`). Funkce běží **souběžně a o sobě nevědí**.
  Max. **25 aktivních discount funkcí** na store.
- **Network access** pro discount funkce je jen Shopify for enterprise → nepoužívat.
- Funkce **nedostane metafield > 10 000 bajtů** (dostane `null`). Config rozděl, hlídej
  contract testem, admin nedovolí uložit config, který se nevejde.
- Vstup funkcí má `shop.localTime` (ověř v Discount API).
- Checkout UI extensions v krocích informace/doprava/platba jen pro Plus → **žádné** vlastní
  UI v pokladně.
- Cart AJAX API: `/cart/update.js` s `discount`, `discount_codes[].applicable`. Storefront
  eventy `shopify:cart:discount-update` využij, kde je téma podporuje.
- Shopify slevy nejde archivovat (ACTIVE / EXPIRED / SCHEDULED).

| Riziko | Primární cesta | Předem schválený fallback |
|---|---|---|
| C1 jeden mozek | Každý Won uzel čte celý config, deterministicky spočítá celý plán slev (vč. zadaných Won kódů z `enteredDiscountCodes`) a vydá jen svůj díl | `combinesWith` + konzervativní strop marže v každém uzlu zvlášť |
| C2 limit 25 | Jeden kódový uzel s více kódy, funkce pozná použitý kód | Limit počtu kódů v adminu, poctivě vysvětlený |
| C3 10 kB | Globální pravidla na uzlu, data per produkt v produktových metafieldech | Tvrdý strop počtu pravidel v adminu |
| C4 čas | `shop.localTime` ve funkci | Nativní `startsAt`/`endsAt` na discount uzlech |
| C5 věrný náhled | Storefront v iframe adminu + náhledový token s neuloženým configem přes app proxy | Náhled s tokeny tématu v adminu + tlačítko „Zobrazit na mém webu“ s náhledovým parametrem |
| C6 kód při přesunu | Záloha → smazání nativní → vytvoření ve Won (rozhodnuto) | — |

Když primární cesta selže, přepni na fallback, zapiš verdikt s důkazem do build logu,
uprav spec a pokračuj. Zastav se, jen když selže i fallback.

## Admin bez přihlášení (dev-only harness)

- Dev-only routa (např. `/dev/preview/*`) renderuje obrazovky adminu s mock session a
  fixture daty. **Nesmí existovat v produkčním buildu** — hlídá to contract test.
- Slouží pro screenshoty 390/1440 a vizuální QA. Reálné vložení do Shopify adminu
  zkontroluje Ondřej.

## Kdy se zastavit a zeptat (jinak jedeš sám až do konce)

- Selže primární cesta **i** fallback rizika.
- Chybí předpoklad, který neumíš zajistit (`config:link`, přihlášení CLI, neplatný token).
- Stejná brána selže 3× po sobě se stejnou příčinou.
- Cokoliv by sahalo mimo dev store, mimo `apps/won-discounts` + sdílené `packages/` +
  `docs/` + `tests/`, nebo na `apps/b2b-companion` a `apps/won-toasts` (tam jen číst).

Když se zastavíš, napiš do build logu přesně co, proč, a co potřebuješ, a Ondřejovi dej
přesný příkaz nebo otázku s doporučenou odpovědí.

## Zakázáno

- `shopify app deploy`, `fly deploy`, publikace témat, jakýkoliv jiný store než dev store.
- Přihlašování do Shopify adminu v prohlížeči.
- Commit tokenu, hesla, `.env`, `.auth/`, lokálních databází.
- Měnit produktová rozhodnutí z `rozhodnuti.md`. Když realita nedovolí rozhodnutí splnit,
  použij schválený fallback nebo se zastav.
- Tvrdit „hotovo“ bez důkazu. Falešné ujištění je horší než přiznaný dluh.

## Stav a pokračování

`docs/won-discounts-build-log.md` je jediný stav běhu: hotová MVP s důkazy, verdikty
rizik, rozhodnutí, parkované otázky, poslední commit. Po kompakci kontextu nebo v nové
session **začni čtením build logu** a pokračuj od posledního nedokončeného kroku.

## Definice hotovo a závěrečný report

Hotovo = MVP 0–7 zelená na bráně i živém E2E Horizon + Dawn, screenshoty ke každé ploše,
roadmapa odpovídá realitě, build log kompletní, vše pushnuté na `main`.

Závěrečný report (česky, do build logu i do chatu):
1. **Hotové a ověřené** (s odkazem na důkaz).
2. **Hotové, ale neověřené** (např. vložení do Shopify adminu, reálný billing charge).
3. **Vědomé kompromisy a fallbacky** (které riziko skončilo fallbackem a proč).
4. **Co má Ondřej zkontrolovat sám** — seznam s přesnými kroky / příkazy.
