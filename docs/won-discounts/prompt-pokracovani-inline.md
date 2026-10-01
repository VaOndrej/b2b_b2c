# Won Discounts — pokračování MVP 3 → MVP 7 (prompt pro AI, práce inline bez subagentů)

> Navazuje na [`prompt-orchestrator.md`](prompt-orchestrator.md). Ten platí dál ve všem, co tento prompt výslovně
> nemění. Mění se jen **způsob práce**: všechno děláš sám, v jednom vlákně, **bez subagentů** (žádný Agent/Task tool,
> žádné paralelní workery, žádné workflow). Heslo ke storefrontu tu není a nikam ho nepiš.

## Role

Jsi vývojář, který dokončuje Shopify appku `won-discounts` v monorepu `~/Development/WonCommerce/Apps/b2b_b2c`
(větev `main`). Aplikace je rozestavěná: MVP 0–2 jsou hotové a pushnuté, MVP 3 je skoro hotové (zbývá uzavření).
Tvůj úkol: uzavřít MVP 3 a postavit MVP 4–7 až do stavu „Shipped“ (připravené k nasazení, **nenasazené**) podle
žebříku v `prompt-orchestrator.md`. Pracuješ autonomně, ptáš se jen v situacích ze sekce „Kdy se zastavit“.

## Začni tady (v tomhle pořadí)

1. `docs/won-discounts-build-log.md` — **jediný stav běhu.** Sekce „Aktuální stav“ a „Předávka MVP 3“ říkají, kde
   přesně jsi. Po každé kompakci kontextu začni znovu tady.
2. `docs/won-discounts/prompt-orchestrator.md` — role, prostředí, MVP žebřík, brána, zakázané věci.
3. `CLAUDE.md`, `AGENTS.md` v rootu repa (zápis do live jen s „go“, `--dry-run` + záloha, důkaz místo tvrzení,
   self-audit, roadmap sync).
4. `docs/won-discounts/rozhodnuti.md` (produktová rozhodnutí — **neměníš je**), `docs/won-discounts/mezery.md`.
5. `docs/won-discounts-mvp-plan.md` — spec (config, engine §3, moduly §4, admin §5, storefront §6, Free/Pro §7, §10).
6. `docs/plans/2026-09-30-won-discounts-mvp3.md` — plán MVP 3 vč. **kontraktů K1–K9 a K4 v2** (platí i pro další MVP).
7. Dle potřeby: `docs/won-app-design-doctrine.md`, `docs/nova-aplikace.md` (§6, §8 Horizon/Dawn, §9 docs),
   `apps/won-discounts/extensions/won-discounts-engine/README.md` (port Rust, rozpočet instrukcí, přijaté rozdíly),
   `apps/won-discounts/docs/` (podpůrná dokumentace).
8. Audity MVP 3: `docs/won-discounts/audits/`. Lokální pracovní záznamy MVP 3 (gitignored, jen na tomhle stroji,
   mohou chybět): `.superpowers/sdd/2026-09-30-won-discounts-mvp3/` — `progress.md` (rozhodnutí a odložené
   drobnosti), `task-*-report.md`. Když tam jsou, čti jen to, co potřebuješ.

Když se zdroje rozcházejí: `rozhodnuti.md` > `mezery.md` > `prompt-orchestrator.md` > tento prompt > build log > plány.

## Jak pracuješ (inline, bez subagentů)

Smyčka každého MVP zůstává z `prompt-orchestrator.md`, jen ji děláš sám a po vrstvách za sebou:

1. **Plán** `docs/plans/<datum>-won-discounts-mvp<N>.md`: cíl, Global Constraints, **kontrakty** (tvary dat mezi
   vrstvami: config, payload funkce, metafieldy, storefront config, view modely, DOM markery) a úkoly po vrstvách.
   Kontrakty zafixuj a commitni **před** implementací.
2. **Testy červené první** u každé vrstvy (core `node:test` přes `tsx`, Rust `cargo test` + TS dvojčata, contract
   testy, integrace appky, UI testy harnessu). E2E piš podle specu, ne podle implementace.
3. **Implementace po vrstvách**, každá vrstva = vlastní commit se zelenými testy té vrstvy:
   core (`packages/core/src/discounts/**`) → Rust funkce (port 1:1, fixtures z TS, parita, rozpočet) → sync
   (`app/lib/sync/**`) → storefront (`extensions/won-discounts-storefront/**`) → admin (`app/components/**`,
   `app/routes/app.*`, `app/lib/integration/**`, i18n cs+en, harness) → podpůrné docs → E2E.
4. **Po každé vrstvě krátká kontrola sebe sama** (místo task review): projdi vlastní diff (`git diff <base>..HEAD`)
   proti plánu a kontraktům; hledej co chybí / navíc / špatně pochopené, testy, které nic netestují, duplikace,
   chybějící ošetření chyb. Najdeš-li problém, oprav ho hned, ne až na konci.
5. **Brána** (vše zelené, jinak MVP nekončí): `npm run test:packages` · `npm run guard:test:core` ·
   `npm run test:unit -w won-discounts` · `npm run typecheck -w won-discounts` · `npm run lint -w won-discounts` ·
   `npm run build -w won-discounts` · `npm run validate:shopify`. Spouštěj je **každý zvlášť** (v zsh smyčce se
   argumenty slepí).
6. **Živé E2E Horizon + Dawn bez `--bail`**, oba `✓` v summary, Free i Pro fáze. „Pending live“ se nepřijímá.
7. **Vizuální QA** 390 + 1440 px: storefront (obě témata) i admin harness; náhled v adminu vs. živý storefront.
8. **Audit místo subagenta `won-auditor`:** po bráně udělej samostatný auditní průchod podle
   `.claude/agents/won-auditor.md` (findings-first, P0–P3, důkaz `soubor:řádek`) nad celým diffem MVP
   (`git log <start>..HEAD`). Zvlášť projdi **shodu Rust ↔ TS** (fixtures, náhodná parita, replay, hraniční vstupy)
   a **rozpočet instrukcí** funkce. Výstup zapiš do `docs/won-discounts/audits/audit-mvp<N>.md`.
   **Oprav všechny nálezy** (P0–P3, Ondřej chce „chyby vždy opravit, než se posuneš dál“) a znovu pusť bránu + E2E.
9. **Self-audit** (AGENTS.md: co jsem ošidil / obešel / neověřil), **roadmap sync** (`docs/product-roadmap.html`,
   karta Won Discounts), **checkpoint v build logu** (formát jako MVP 1–2), commit + `git push origin main`
   (commity česky, stručně, s `Co-Authored-By`).
10. Po každém MVP napiš Ondřejovi 3 řádky: co je hotové, důkaz, co zůstalo neověřené.

Šetři kontext: velké výstupy (logy, diffy, JSON) přesměruj do souboru ve scratchpadu a čti jen potřebné části.
Build log průběžně aktualizuj (před každou delší operací), ať jde práce navázat i po kompakci.

## Co zbývá v MVP 3 (přesně)

Stav a poslední commit jsou v build logu („Předávka MVP 3“). Zbývá:

1. **Kontrola poslední opravné dávky** (audit MVP 3 a review): projdi diff `ba6f5d7..HEAD` a ověř proti
   `docs/won-discounts/audits/audit-mvp3.md` a `audit-mvp3-drift.md`, že je každý nález opravený. Co neprojde,
   oprav. Otevřený zůstal drift P3-2 (viz build log) — rozhodni a zapiš.
2. **Brána** (bod 5 výš) — všechno zelené.
3. **Finální živé E2E** (návod v build logu, „E2E runbook MVP 3“):
   - **Fáze A (Free):** čerstvý restart `shopify app dev` **bez** `WON_DEV_PLAN`; od restartu do konce běhu
     **neměň nic v `apps/won-discounts/extensions/`** (každé přestavění funkce rozbije dev assety storefrontu —
     404 do dalšího restartu). Nejdřív ověř, že `won-discounts.js` a `won-discounts-tiers*.js` na CDN vrací 200.
     Matice profilů `mvp1`, `shapes`, `margin` (vč. SK/EUR), `tiers` na Horizon i Dawn.
   - **Fáze B (Pro):** restart s `WON_DEV_PLAN=pro`, profily `tiers-pro` (sada na kolekci + počítání přes košík,
     fakt F-T1 pro `tierRef`), `margin-pro`, `shapes` Pro.
   - Navíc ověř naživo v trhu SK: `Shopify.currency.rate` na stránce = kurz funkce (`presentmentCurrencyRate`) a
     ceny tabulky ve formátu EUR (K4 v2).
   - Úklid + `verify-clean`. Evidence do `docs/won-discounts/evidence/mvp3/e2e-final-A|B/`.
4. **Vizuální QA** storefront PDP 390/1440 obě témata (všechny 4 vzhledy aspoň na jednom tématu) + admin harness;
   porovnej náhled v adminu s živým PDP.
5. **Self-audit, roadmapa** (MVP 3 hotové, badge `Beta`), **checkpoint MVP 3 v build logu**, commit + push.

## MVP 4–7

Obsah a exit kritéria jsou v tabulce „MVP žebřík“ v `prompt-orchestrator.md` a v §10 specu. K tomu:

- **Odložené body z dřívějších MVP** (seznam v build logu, „Parkované otázky a dluh“) zařaď do MVP, kterému patří
  (např. `tierHint` pro „přidej 1 ks“ v košíku MVP 4 — dnes ignoruje výlučný přepínač produkt/objednávka;
  scheduler MVP 5 i pro úklid historie a srovnání nákupních cen; kampaně MVP 6 vč. fáze 1 přepnutí; MVP 7
  Postgres port, docs corpus, editor textů storefrontu + kontrola 128 kB storefront configu při uložení, oříznutá
  úroveň: lepší text v pokladně, hustší payload úrovní pro zvednutí stropu 550 B).
- **MVP 4 (Odměny + košík):** dárek je reálný skladový produkt s atributem `_won_gift`; v pokladně vždy zdarma;
  práh per měna (CZ i SK), košík v embedu (progress, dárek s „Odmítnout“, pole pro kód + varování o dárku,
  „Ušetříš X“, tip „přidej 1 ks“). Embed nikdy nemění košík bez akce zákazníka (SF-1), JS ≤ 10 kB gz celkem.
- **MVP 5 (Výprodej, Pro):** kvóta na existující variantě (`price` + `compare_at_price`), ceníky trhů vč. pevných
  cen, storna/vratky vrací kus, návrat ceny po vyčerpání/datu, historie kroků, scheduler. Zápisy cen jen skriptem s
  `--dry-run` + zálohou; po E2E vše vrátit.
- **MVP 6 (Kampaně, Pro):** okno + přepisy napříč moduly, atomický start/konec (C4: `shop.localTime` +
  `varsVersion`, 3fázové přepnutí z `function-payload.ts`), kill switch, zákaz překryvu.
- **MVP 7 (Dotažení):** onboarding do 3 minut, Přehled, Vzhled Pro + návod pro AI, analytika Free/Pro, billing +
  downgrade (A6) + „Připravit na odinstalaci“ (A7), BETA ceny na kartách, support/chatbot docs, `Dockerfile` +
  `fly.toml` (**nenasazovat**), BFS kontrola, roadmap badge `Shipped`, závěrečný report podle orchestrátoru.

## Technická pravidla, která musíš držet (naučené v MVP 0–3)

- **Funkce je v Rustu** (`extensions/won-discounts-engine`), TS engine `@won/core/discounts` je reference. Každá
  změna logiky enginu = změna TS **i** Rustu v tomtéž kroku + regenerace fixtures z TS + náhodná parita (0 rozdílů)
  + `tests/replay-logs.mjs` (replay skutečných běhů beze změny výstupu) + měření rozpočtu instrukcí.
- **Rozpočet instrukcí:** měř na skutečné hranici vstupu (128 kB MessagePack škálované počtem řádků, id ve formátu
  appky). Brány: realistické košíky ≤ 90 %, běžné fixtures ≤ 70 %, **žádný zkonstruovatelný tvar ≥ 100 %**.
  Každé nové čtení dat per řádek přeměř. Adversariální hledání dělej jednou s předem daným stop-pravidlem; když tvar
  přesáhne 100 %, zaveď mez (jako `MAX_STACK_CANDIDATES`, 25 kódů, strop úrovní 550 B) a zapiš ji do specu.
- **Dotaz funkce ≤ 3000 znaků včetně komentářů**, cena ≤ 30; Wasm < 256 kB (dnes ~252 kB — šetři).
- **Config funkce ≤ 9 000 B** (shop metafield; nad 10 000 B dorazí `null` bez chyby). Admin nedovolí uložit, co se
  nevejde; sync to nikdy nepošle.
- **BILL-1:** payload funkce, storefront config, produktové/variantní metafieldy i admin data se staví z
  `gateConfigForPlan(config, plan)`, nikdy z uloženého configu. Ořez Pro nikdy nesmí slevu rozšířit (fail closed).
- **Sync pořadí:** zápisy, které můžou slevu zvětšit, až po zápisu shop configu (AFTER lane); při změně, která může
  jít oběma směry, nejdřív neutrální stav (např. `tierRef: "~"`), finální hodnota potom.
- **Storefront:** Liquid čte app-data metafield přes `app.metafields.won_discounts.<key>` (bez `$app`), resource
  metafieldy přes `product.metafields["$app:won_discounts"].<key>`. **Shopify tokenizer ukončí `{{ … }}` na prvním
  `}`** — žádné `'{x}'` uvnitř výstupního tagu (theme check ani liquidjs to nechytí; hlídá contract test). Každý JS
  asset ≤ 10 000 B raw (Theme Check), všechno JS ≤ 10 kB gz. Stránka produktu nikdy neslíbí víc, než dá pokladna
  (property test JS ↔ `planCart`).
- **Dev store** `b2b-b2c-store-development.myshopify.com` je jediný povolený store. Základní měna obchodu je **CZK**
  (od 2026-09-30), trhy `cesko` (CZK) a `slovensko` (EUR, automatický převod), jazyky en/cs/sk, Bogus Gateway.
  Testovací katalog `won-e2e-*` (ceny 10–22 Kč, nákupní ceny 5–8 Kč) — nové produkty nezakládej.
- **`shopify app dev`:** spouštěj ho detached/na pozadí, log do scratchpadu; **log obsahuje tokeny — nikdy ho
  nevypisuj celý ani necommituj** (grepuj jen konkrétní řádky). Před spuštěním ověř porty. Offline session na dev
  storu existuje (webhooky a background joby běží).
- **Čtení stavu storu:** `shopify app execute` (jako appka) nebo `shopify store execute` (Ondřejův CLI login, jen
  čtení). Zápisy jen skripty v `apps/won-discounts/scripts/**` s `--dry-run` napřed a zálohou.
- **Cloudflare na storefrontu:** tempo zápisů do košíku ≥ 1,5 s.
- **Nestabilní test = chyba brány:** časovače v testech nahraď injektovanými hodinami.
- Před tvrzením „hotovo“ vždy důkaz: výstup testu, screenshot 390/1440, dry-run výpis, E2E summary.

## Bezpečnost a zakázané věci

- Nikdy nečti ani nevypisuj `shpat.md`, `.env*`, `.auth/`, `prisma/dev.sqlite`, log `shopify app dev` celý.
  Heslo ke storefrontu je jen v gitignorovaném `apps/won-discounts/.env` (`SHOPIFY_E2E_STOREFRONT_PASSWORD`),
  načítá ho E2E loader — nikdy ho nepiš jinam.
- Zakázáno: `shopify app deploy`, `fly deploy`, publikace témat, jiný store než dev store, přihlášení do Shopify
  adminu v prohlížeči, commit tokenů/hesel/`.env`/`.auth/`/lokálních DB, měnit `rozhodnuti.md`.
- Měnit smíš jen `apps/won-discounts/**`, sdílené `packages/**`, `docs/**`, `tests/**`. `apps/b2b-companion` a
  `apps/won-toasts` jen čti (`npm run guard:test:core` nesmí zčervenat).

## Kdy se zastavit a zeptat

- Selže primární cesta i schválený fallback rizika.
- Chybí předpoklad, který neumíš zajistit (přihlášení CLI, `config:link`, neplatný přístup).
- Stejná brána selže 3× po sobě se stejnou příčinou.
- Cokoliv mimo povolené cesty nebo mimo dev store; produktové rozhodnutí, které `rozhodnuti.md` neřeší a nejde
  vyřešit volbou s výchozí hodnotou.

Když se zastavíš: zapiš do build logu co, proč a co potřebuješ; Ondřejovi dej přesný příkaz nebo otázku s doporučenou
odpovědí.

## Definice hotovo

MVP 3–7 zelené na bráně i živém E2E Horizon + Dawn (Free i Pro), screenshoty ke každé ploše, audit každého MVP s
opravenými nálezy, roadmapa odpovídá realitě (badge `Shipped`), build log kompletní, vše pushnuté na `main`, nic
nasazené. Závěrečný report podle `prompt-orchestrator.md` (hotové a ověřené / hotové neověřené / kompromisy a
fallbacky / co má Ondřej zkontrolovat sám s přesnými příkazy).
