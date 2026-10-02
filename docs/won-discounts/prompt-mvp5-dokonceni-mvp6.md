# Won Discounts — dokonči MVP 5 (5a, 5b), pak MVP 6 (prompt pro AI, inline bez subagentů)

> **TOHLE JE TVOJE ZADÁNÍ. Po každé kompakci kontextu ho přečti celé znovu** (`docs/won-discounts/prompt-mvp5-dokonceni-mvp6.md`),
> pak `docs/won-discounts-build-log.md` sekci „Aktuální stav“ a checkpoint MVP 5. Shrnutí z kompakce je jen pomůcka;
> když se s tímto souborem nebo build logem rozchází, platí soubory. Nic nepovažuj za splněné, dokud to build log neříká
> s důkazem.

## Kdo jsi a kde jsi

Dokončuješ Shopify appku `won-discounts` v monorepu `~/Development/WonCommerce/Apps/b2b_b2c` (větev `main`). Pracuješ
**sám, inline, bez subagentů** (žádný Agent/Task tool, žádné workflow). MVP 0–4 jsou uzavřené, MVP 4 nezávisle ověřené.
MVP 5 (Výprodej, Pro) je postavené, prošlo bránou, živým E2E Free + Pro na Horizonu i Dawnu a auditem
(`docs/won-discounts/audits/audit-mvp5.md`, checkpoint v build logu). Chybí jen počítání kvóty z objednávek, protože
Shopify appce zatím nepouští objednávky (chráněná data zákazníků, ověřeno 2× sondou: odběr webhooku i přímý dotaz na
posledních 60 dní = `ACCESS_DENIED`). Ondřej žádost schválí později.

Rozhodnutí Ondřeje (2026-10-02):
- MVP 5 rozdělit na **5a** (hotové → uzavřít) a **5b** (kvóta / storna / vratky z objednávek → až po schválení).
- **MVP 6 smí začít po uzavření 5a**, nečeká na 5b.
- Storno testovacích objednávek v E2E přes `shopify store execute --allow-mutations` **je povolené** (jen objednávky,
  které E2E samo vytvořilo na `won-e2e-*`).

## Krok 0 — pojistka proti ztrátě kontextu (hned)

1. V `docs/won-discounts-build-log.md`, sekce „Aktuální stav“, přepiš řádek „Aktivní zadání“ na:
   `- **Aktivní zadání:** docs/won-discounts/prompt-mvp5-dokonceni-mvp6.md (5a → 5b po schválení → MVP 6). Krok: 5a.`
   a průběžně ho přepisuj (5a-admin, 5a-5b-příprava, 5a-uzavření, MVP6-plán, …).
2. V paměti `~/.claude/projects/-Users-ondrej-Development-WonCommerce-Apps/memory/won-discounts-inline-severka.md`
   nahraď odkaz na aktivní zadání tímto souborem.
3. Před každou dlouhou operací (brána, E2E, měření) zapiš do build logu, co spouštíš, kam jdou logy a co je další krok.

## Zdroje (čti v tomhle pořadí, jen co potřebuješ)

1. `docs/won-discounts-build-log.md` — Aktuální stav, checkpoint MVP 5, Poučení, Parkované otázky a dluh.
2. `docs/won-discounts/prompt-pokracovani-inline.md` — technická pravidla, zakázané věci, kdy se zastavit (platí dál).
3. `docs/won-discounts/prompt-orchestrator.md` — MVP žebřík (řádky MVP 5 a 6), brána.
4. `docs/won-discounts/rozhodnuti.md` (neměnit), `docs/won-discounts/mezery.md` (A6, A7), `docs/won-discounts-mvp-plan.md`
   (§3 C4 kampaně, §4.6 Kampaně, §7, §10).
5. `docs/plans/2026-10-02-won-discounts-mvp5.md` — kontrakty O1–O11, živá fakta F-O1…F-O5, rozpočet.
6. `docs/won-discounts/audits/audit-mvp5.md`, README funkce `apps/won-discounts/extensions/won-discounts-engine/README.md`
   (rozpočet: **rezerva 0,11 bodu, oba dotazy 30/30**), runbook `apps/won-discounts/scripts/e2e/runbook/README.md`.

Priorita při rozporu: `rozhodnuti.md` > `mezery.md` > `prompt-orchestrator.md` > `prompt-pokracovani-inline.md` > tento
soubor > build log > plány.

## Část 5a — uzavřít MVP 5 bez objednávek

1. **Poctivý admin:** dokud appka nemá přístup k objednávkám, modul Výprodej (a karta na Přehledu) to řekne:
   „Kvóta se zatím neodečítá — výprodej skončí datem nebo ručně.“ (cs + en). Zjištění přístupu: scope `read_orders`
   v session a úspěšné čtení objednávek (výsledek cachovat, chyba `ACCESS_DENIED` = nepřístupné); bez přístupu formulář
   upozorní u kvóty a doporučí datum konce. Testy červeně první (integrace + UI), harness stav, screenshoty 390/1440
   do `docs/won-discounts/evidence/mvp5/admin/`. Docs (concept clearance, support) totéž.
2. **Připravit 5b dopředu**, vypnuté:
   - spec `apps/won-discounts/tests/e2e/storefront.outlet.spec.ts`: test „Bogus objednávky do vyčerpání kvóty → webhook
     → ceny zpět“ a „storno objednávky (`orderCancel` s restockem přes `shopify store execute --allow-mutations`) →
     kus zpět, historie“; běží jen s `WON_E2E_ORDERS=1`, jinak `test.skip` s důvodem F-O1;
   - skript pro storno v `apps/won-discounts/scripts/e2e/` (dry-run napřed, jen objednávky z tohoto běhu, výpis);
   - v plánu MVP 5 přesný postup aktivace (scope `read_orders`, `[[webhooks.subscriptions]]` `orders/create`,
     `orders/cancelled`, `refunds/create` → `/webhooks/outlet`, `WON_E2E_ORDERS=1`, `profile.sh outlet … pro`).
   Do `shopify.app.toml` **nic nepřidávej** (Shopify by odmítl konfiguraci celé dev appky).
3. Brána (`runbook/gate.sh`), dotčené E2E (`profile.sh outlet <tag> free` a `… pro`, app dev restart s/bez
   `WON_DEV_PLAN=pro`), krátký audit dávky do `audit-mvp5.md`, checkpoint MVP 5 v build logu přepsat na
   „MVP 5a ✅, 5b čeká na schválení“, roadmapa (jen řádek Won Discounts, trik s blobem z HEAD — viz MVP 4/5 v gitu),
   commit + `git push origin main`.

## Část 5b — jen když je přístup schválený

Na začátku session (a před MVP 6) ověř sondou, jestli Ondřej žádost už schválil: dočasně `read_orders` v toml, `shopify
app dev`, dotaz `orders(first:1)` jako appka. `ACCESS_DENIED` → toml vrátit, krátce app dev (vrátí konfiguraci), zapsat
do build logu a pokračovat MVP 6. Schváleno → aktivuj podle postupu z plánu, živé E2E kvóty a storna (Free i Pro,
Horizon i Dawn), audit, checkpoint „MVP 5 ✅“, commit + push. Kontrakt O7 (idempotence po řádku, přeprodej, vratka
po konci) je hotový a otestovaný podepsanými payloady — měň jen to, co živý běh ukáže.

## Část MVP 6 — Kampaně (Pro)

Obsah a exit kritéria: `prompt-orchestrator.md` (řádek MVP 6), spec §4.6 a C4. Shrnutí: okno kampaně + sada
pravidel / přepisů napříč moduly, **atomický start a konec** (C4: `shop.localTime.dateTimeBetween` s `campaignStart` /
`campaignEnd` z `function_vars` + `varsVersion`, 3fázové přepnutí z `function-payload.ts`), náhled košíku v čase
kampaně (Vyzkoušet košík), kill switch, zákaz překryvu. Dluh z MVP 2: fáze 1 přepnutí kampaně posílá nová pravidla,
i když finální zápis zůstane zadržený (build log „Parkované otázky a dluh“). Downgrade (A6): běžící kampaň doběhne,
nová nejde založit — `plan-gate.ts` dnes kampaně ve Free odřízne úplně, potřebuje seznam kampaní, které smí doběhnout.

Smyčka stejná jako MVP 5 (podrobně `prompt-pokracovani-inline.md`, „Jak pracuješ“):
1. **Rozpočet instrukcí jako první:** rezerva je 0,11 bodu a dotazy 30/30. Kampaně funkce už čte (`campaignActive`);
   každá změna logiky funkce se přeměří na rodinách cap 550 (`.superpowers/sdd/2026-10-01-won-discounts-mvp4/
   budget-families-cap550.tar.gz` → scratchpad, `tests/budget-families/batch.mjs`, + `outlet-flag-variants.mjs` s
   `wonOutlet`). Stop-pravidlo předem v plánu. Nové pole v dotazu jen za cenu jiného.
2. **Plán** `docs/plans/<datum>-won-discounts-mvp6.md` s kontrakty (config kampaně, payload a vars uzlů, sync a pořadí
   zápisů, scheduler pro start / konec — `app/lib/jobs/scheduler.server.ts` už existuje, admin view modely, storefront),
   živá fakta k ověření, „rozhodnuto výchozí hodnotou“. Commit **před** implementací.
3. **Vrstvy** core → Rust → sync / scheduler → storefront → admin → docs → E2E, testy červeně první, **po každé vrstvě
   celý `npm run test:unit -w won-discounts`**, každá vrstva = commit.
4. Brána, živé E2E Free (kampaň nejde založit, nic se nemění) + Pro na Horizon i Dawn (kampaň začne a skončí v čase
   podle C4, po konci stav jako předtím), regrese profilů MVP 1–5, vizuální QA 390 + 1440, audit
   `docs/won-discounts/audits/audit-mvp6.md`, opravy, self-audit, roadmapa, checkpoint MVP 6, commit + push.

Po MVP 6 se zastav a napiš report. MVP 7 nezačínej.

## Poučení, která musíš držet (MVP 3–5)

- **Nepouštěj `prettier`** (repo nemá config). Před commitem `git diff --stat`.
- **Nikdy neměň `apps/won-discounts/extensions/**` během běžícího `shopify app dev`**; `npm run test:unit` přestavuje
  Wasm → nepouštěj ho při běžícím app dev (nebo app dev potom restartuj). Po změně extensionu restart app dev.
- **Konfigurace s nepovoleným tématem/scope rozbije celou dev appku** (Shopify ji odmítne): `orders/*` webhooky do toml
  až po schválení.
- **Fronta per běh platí jen v procesu** — skripty vedle `shopify app dev` sdílí DB; stav, který jde převzít jiným
  procesem, potřebuje zápůjčku (`nextAttemptAt`), viz A5 v auditu MVP 5.
- **Shopify Markets (F-O3):** v trhu s ceníkem varianta bez pevné ceny nemá kontextovou compare-at; ověřuj ceny přes
  `contextualPricing` a storefront `/products/<handle>.js` v trhu (`setStorefrontCountry`).
- E2E zapisující do košíku přes `Shopify.actions.updateCart` běží na doméně storu s `?preview_theme_id=`; rate limit
  Cloudflaru (429) → pauzy. Dawn: velikosti v `px`. JS storefrontu ≤ 10 240 B gz dohromady (rezerva ~14 B) — nový JS
  jen po uvolnění místa, jinak Liquid bez skriptu.
- **Opakovaný (flaky) test je nález:** dohledej příčinu (MVP 5: výpadek doručení logů funkce do app dev, izolovaně 3/3).
- Evidence E2E jde do `docs/won-discounts/evidence/mvp<N>/` a commituje se (zkontroluj, že neobsahuje tajné údaje).
- Heslo storefrontu jen v `apps/won-discounts/.env`; nikdy nevypisuj `.env*`, `shpat.md`, `.auth/`,
  `prisma/dev.sqlite`, celý log `shopify app dev`.

## Zakázané

`shopify app deploy`, `fly deploy`, publikace témat, jiný store než `b2b-b2c-store-development.myshopify.com`,
přihlášení do Shopify adminu nebo Partner Dashboardu v prohlížeči, commit tokenů/hesel/`.env`/`.auth/`/lokálních DB,
změna `rozhodnuti.md`, změny mimo `apps/won-discounts/**`, `packages/**`, `docs/**`, `tests/**`. `shopify store execute`
smí zapisovat **jen** storno testovacích objednávek z E2E (povolil Ondřej), jinak jen čtení.

## Kdy se zastavit a zeptat

Selže primární cesta i schválený fallback; chybí předpoklad, který neumíš zajistit; stejná brána selže 3× se stejnou
příčinou; produktové rozhodnutí, které `rozhodnuti.md` neřeší a nejde vyřešit výchozí hodnotou (zapiš do plánu jako
„rozhodnuto výchozí hodnotou“). Zastavení: do build logu co / proč / co potřebuješ, Ondřejovi přesný příkaz nebo
otázku s doporučenou odpovědí.

## Report Ondřejovi (na konci, česky, pod ~1 200 znaků)

1. Jedna věta: co je hotové (5a, 5b ano/ne, MVP 6).
2. Odrážky s `soubor:řádek` / commitem: co přibylo, důkazy (brána, E2E ✓✓, evidence), nálezy auditu.
3. Co zůstalo neověřené a co má Ondřej zkontrolovat sám — s přesným příkazem do terminálu.
