# Won Discounts — MVP 6.1 (kampaně + úrovně) a MVP 7 Dotažení (prompt pro AI, inline bez subagentů)

> **TOHLE JE TVOJE ZADÁNÍ. Po každé kompakci kontextu ho přečti celé znovu** (`docs/won-discounts/prompt-mvp7.md`),
> pak `docs/won-discounts-build-log.md` sekci „Aktuální stav“ a checkpointy MVP 5–6. Shrnutí z kompakce je jen
> pomůcka; když se s tímto souborem nebo build logem rozchází, platí soubory. Nic nepovažuj za splněné, dokud to build
> log neříká s důkazem.

## Kdo jsi a kde jsi

Dokončuješ Shopify appku `won-discounts` v monorepu `~/Development/WonCommerce/Apps/b2b_b2c` (větev `main`). Pracuješ
**sám, inline, bez subagentů**. MVP 0–4 a 6 jsou uzavřené, MVP 5 je uzavřené jako 5a; 5b (kvóta z objednávek) je
připravené vypnuté a **odložené** (Shopify zatím appce nepouští objednávky, sonda 2026-10-04 `ACCESS_DENIED`).
MVP 7 je poslední příčka žebříku: po něm je appka **Shipped** = připravená k nasazení, **nenasazená**.

## Rozhodnutí Ondřeje (2026-10-04) — platí přednostně před plány, `rozhodnuti.md` neměň

1. **5b odložit.** Implementaci dokončit, živě netestovat: skript aktivace (toml scope `read_orders` + odběr
   `orders/create`, `orders/cancelled`, `refunds/create` → `/webhooks/outlet`, přepnutí docs) připravit tak, aby po
   schválení stačil jeden krok; do `shopify.app.toml` **nic nepřidávej** (Shopify by odmítl konfiguraci celé dev appky).
   Sondu na začátku session dělat **nemusíš**; když ji Ondřej ohlásí jako úspěšnou, aktivuj podle plánu MVP 5.
2. **Kampaně mění i množstevní slevy (úrovně), dárky ne** (řeší D1 z plánu MVP 6). Přepis sady úrovní v kampani smí
   být jen **stejně nebo víc štědrý** než základ pro každé množství (admin jinak neuloží). Tabulka úrovní na PDP se
   přepne na kampaňovou **minutu po startu** a zpět **před koncem** s rezervou (scheduler zapíše storefront config),
   takže web nikdy neslíbí víc než pokladna. Dárky v kampani zůstávají beze změny (admin to říká).
3. **Rozpočet JS na webu = za stránku ≤ 10 kB gz** (dřív „všechno JS dohromady“). Doporučení Shopify je 10 KB
   komprimovaného JS na rozšíření (suggested). Uprav spec SF-2 a perf contract test: měř per typ stránky (PDP, košík,
   kolekce / vyhledávání), každý soubor dál ≤ 10 000 B raw (Theme Check).
4. **Ceny podle množství na kartách (BETA)**: Horizon i Dawn **automaticky** po zapnutí v adminu; jiná témata:
   merchant vloží blok (PDP blok úrovní už existuje; do karty, pokud ji téma umí). Zjištěno 2026-10-04: karta produktu
   Horizonu přijímá bloky appky (`blocks/_product-card.liquid` → `"type": "@app"`), Dawn ne (`snippets/card-product.liquid`).
   Výchozí cesta k ověření v plánu: Horizon = blok appky v kartě (Liquid, bez JS), vložený automaticky/deep linkem;
   Dawn = skript z embedu jen na stránkách kolekce a vyhledávání (rozpočet té stránky). Nikdy neslíbit víc než
   pokladna (property test jako u PDP).
5. **Analytika**: postavit celou, testovat mocky (podepsané webhooky `orders/create` podle formátu z dokumentace,
   seed `OrderDiscountFact`, harness + screenshoty); živé doručení webhooků čeká na stejné schválení jako 5b.
6. **Billing**: Ondřej schválí testovací předplatné na dev storu. Až na to dojde, zastav se s **přesným krokem**
   (URL / co kliknout) a pokračuj ostatním, dokud neodpoví.

## Krok 0 — pojistka proti ztrátě kontextu

1. V build logu, „Aktuální stav“, řádek „Aktivní zadání“ → `docs/won-discounts/prompt-mvp7.md. Krok: 6.1-B0.` a
   průběžně přepisuj.
2. V paměti `~/.claude/projects/-Users-ondrej-Development-WonCommerce-Apps/memory/won-discounts-inline-severka.md`
   nahraď odkaz na aktivní zadání tímto souborem.
3. Před každou dlouhou operací (brána, E2E, měření) zapiš do build logu, co běží, kam jdou logy a co je další krok.

## Zdroje (čti jen co potřebuješ)

1. `docs/won-discounts-build-log.md` — Aktuální stav, checkpointy MVP 5–6, Poučení, Parkované otázky a dluh.
2. `docs/won-discounts/prompt-pokracovani-inline.md` — technická pravidla, zakázané věci, „Jak pracuješ“ (platí dál).
3. `docs/won-discounts/prompt-orchestrator.md` (řádek MVP 7, brána, závěrečný report), `rozhodnuti.md` (neměnit),
   `mezery.md` (A6, A7, A13), `docs/won-discounts-mvp-plan.md` (§4.6, §5, §6, §7, §8, §10).
4. `docs/plans/2026-10-02-won-discounts-mvp6.md` (K1–K9, D1–D6, výsledek B0), `audits/audit-mvp6.md`,
   `docs/plans/2026-10-02-won-discounts-mvp5.md` („Aktivace 5b“).
5. README funkce `apps/won-discounts/extensions/won-discounts-engine/README.md` (rozpočet; rezerva živé kampaně
   **0,14 bodu**, dotazy 30/30), runbook `apps/won-discounts/scripts/e2e/runbook/README.md`.

## Část 6.1 — kampaně mění i úrovně (napřed, mění funkci)

1. **B0 rozpočet napřed** (stop-pravidlo do plánu před měřením): funkce pro živou kampaň s `tiers` v kampani čte
   kompaktní sady kampaně **místo** základních (nikdy obojí), strop 550 B platí pro obě; přeměř rodiny cap 550
   (`budget-families-cap550.tar.gz` → scratchpad; základ přes `outlet-flag-variants.mjs` `MODES=none`, pak
   `campaign-variants.mjs` rozšířený o režim s úrovněmi). **Pozor (MVP 6):** surové vstupy rodin bez `wonOutlet`
   nejsou platné (101,7 % bez kampaně) — měř jen na tvaru dnešního dotazu.
2. Plán `docs/plans/<datum>-won-discounts-mvp6-1.md`: kontrakty (payload kampaně s `tiers`, výběr v enginu TS + Rust,
   validace „stejně nebo víc štědré“, storefront přepnutí se zpožděním / předstihem přes `campaigns.due`, admin
   přepisu sady), commit před implementací.
3. Vrstvy core → Rust (port 1:1, fixtures z TS, parita, replay, rozpočet) → sync / scheduler → storefront → admin →
   docs → E2E (kampaň s úrovní: PDP tabulka v okně kampaňová, mimo okno základní; `/cart.js` + pokladna).
4. Brána, E2E Free + Pro Horizon + Dawn, audit (doplň `audit-mvp6.md` sekcí 6.1), checkpoint, commit + push.

## Část MVP 7 — Dotažení

Obsah a exit kritéria: `prompt-orchestrator.md` (řádek MVP 7), spec §10. Shrnutí: onboarding do 3 minut (kroky 1–5),
Přehled, Vzhled Pro + **návod pro AI** (datový kontrakt, eventy, CSS proměnné, příklad; SEC-3 scoped CSS), analytika
Free / Pro (§8, bez PII), billing (`appSubscriptionCreate`, test na dev storu, $29 / měsíc, 14denní trial) + downgrade
(A6 živě) + „Připravit na odinstalaci“ (A7), BETA ceny na kartách (rozhodnutí 4), support / chatbot docs (corpus jako
u Toasts), `Dockerfile` + `fly.toml` (**nenasazovat**, A13), Postgres port (Docker lokálně je k dispozici), BFS
kontrola (statická + co jde změřit lokálně), roadmap badge `Shipped`. Dluh pro MVP 7 je v build logu („Parkované
otázky a dluh“, výskyty „MVP 7“): editor textů storefrontu + kontrola 128 kB storefront configu, hustší payload úrovní,
formát ceny v bloku vs. téma, mezera pod „Zaplatit“ na Horizonu (V1), Postgres, single-instance předpoklady, docs
corpus. Smyčka stejná jako MVP 6: plán s kontrakty (commit napřed) → vrstvy s testy červeně první a celým `test:unit`
po každé vrstvě → brána → živé E2E Free + Pro Horizon + Dawn + regrese MVP 1–6 → vizuální QA 390 + 1440 → audit
`audits/audit-mvp7.md` s opravami → self-audit → roadmapa → checkpoint → commit + push → závěrečný report podle
orchestrátoru.

## Poučení, která musíš držet (MVP 3–6)

- **Nepouštěj `prettier`**. Před commitem `git diff --stat`.
- **Nikdy nic neměň v `apps/won-discounts/extensions/**` během běžícího `shopify app dev`** (ani testovací nástroje);
  `npm run test:unit` přestavuje Wasm → ne při běžícím app dev.
- Konfigurace s neschváleným scope / tématem webhooku rozbije celou dev appku.
- Po změně `prisma/schema.prisma` migrace + `npm run prisma:migrate:deploy -w won-discounts` pro dev DB.
- Testy syncu: plán se v běhu bere z `deps.plan`, ne z objektu Sync (MVP 6: test přes `productionSyncDeps` + `plan`).
- Shopify CLI může přechodně vrátit 403 (App Management) → profil zopakuj samostatně, úklid zkontroluj.
- Text z `Intl` obsahuje nezlomitelné mezery — v testech regex `\s`.
- E2E: tempo zápisů do košíku ≥ 1,5 s, evidence do `docs/won-discounts/evidence/mvp<N>/`, bez tajných údajů.
- Heslo storefrontu jen v `apps/won-discounts/.env`; nikdy nevypisuj `.env*`, `shpat.md`, `.auth/`,
  `prisma/dev.sqlite`, celý log `shopify app dev`.

## Zakázané

`shopify app deploy`, `fly deploy`, publikace témat, jiný store než `b2b-b2c-store-development.myshopify.com`,
přihlášení do Shopify adminu nebo Partner Dashboardu v prohlížeči, commit tokenů / hesel / `.env` / `.auth/` / lokálních
DB, změna `rozhodnuti.md`, změny mimo `apps/won-discounts/**`, `packages/**`, `docs/**`, `tests/**`.
`shopify store execute` jen čtení (storno testovacích objednávek až s aktivací 5b).

## Kdy se zastavit a zeptat

Selže primární cesta i fallback; chybí předpoklad, který neumíš zajistit (schválení billingu → přesný krok a jeď
dál jinými úkoly); stejná brána 3× se stejnou příčinou; produktové rozhodnutí, které `rozhodnuti.md` ani tento
soubor neřeší a nejde vyřešit výchozí hodnotou (zapiš do plánu „rozhodnuto výchozí hodnotou“). Zastavení: do build
logu co / proč / co potřebuješ, Ondřejovi přesný příkaz nebo otázku s doporučenou odpovědí.

## Report Ondřejovi (na konci, česky, pod ~1 200 znaků)

1. Jedna věta: co je hotové (6.1, MVP 7, Shipped ano/ne).
2. Odrážky s `soubor:řádek` / commitem: co přibylo, důkazy (brána, E2E ✓✓, evidence), nálezy auditu.
3. Co zůstalo neověřené (5b, živá analytika) a co má Ondřej zkontrolovat sám — s přesným příkazem do terminálu.
