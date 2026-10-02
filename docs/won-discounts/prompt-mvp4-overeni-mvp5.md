# Won Discounts — ověř MVP 4, pak MVP 5 (prompt pro AI, inline bez subagentů)

> **TOHLE JE TVOJE ZADÁNÍ. Po každé kompakci kontextu ho přečti celé znovu** (`docs/won-discounts/prompt-mvp4-overeni-mvp5.md`),
> pak `docs/won-discounts-build-log.md` sekci „Aktuální stav“. Shrnutí z kompakce je jen pomůcka; když se s tímto souborem
> nebo build logem rozchází, platí soubory. Nic z tohoto zadání nepovažuj za splněné, dokud to build log neříká s důkazem.

## Kdo jsi a co děláš

Jsi vývojář, který dokončuje Shopify appku `won-discounts` v monorepu `~/Development/WonCommerce/Apps/b2b_b2c` (větev `main`).
MVP 0–4 jsou hotové a pushnuté (checkpoint MVP 4 v build logu, audit `docs/won-discounts/audits/audit-mvp4.md`).
Pracuješ **sám, inline, bez subagentů** (žádný Agent/Task tool, žádné workflow, žádní paralelní workeři).

Dva kroky, **přísně za sebou**:

1. **Ověř MVP 4** nezávisle (část A). Dokud není ověřené, na MVP 5 nesahej.
2. **MVP 5 — Výprodej (Pro)** až do uzavření (část B): plán, implementace po vrstvách, brána, živé E2E, QA, audit, push.

Po MVP 5 se zastav a napiš Ondřejovi report (formát dole). MVP 6 nezačínej, to bude nová session.

## Krok 0 — pojistka proti ztrátě kontextu (udělej hned)

1. Do `docs/won-discounts-build-log.md`, sekce „Aktuální stav“, hned pod blok „Severka“ přidej řádek:
   `- **Aktivní zadání:** docs/won-discounts/prompt-mvp4-overeni-mvp5.md (ověření MVP 4 → MVP 5). Krok: A1.`
   Ten řádek **průběžně přepisuj** na aktuální krok (A1…A6, B-plán, B-core, …, B-push). Commitni ho s prvním commitem.
2. Do paměti (`~/.claude/projects/-Users-ondrej-Development-WonCommerce-Apps/memory/won-discounts-inline-severka.md`)
   doplň větu: „Aktivní zadání: docs/won-discounts/prompt-mvp4-overeni-mvp5.md — po kompakci číst nejdřív.“
3. Před každou dlouhou operací (E2E, brána, měření) zapiš do build logu, co spouštíš, kam jdou logy a co je další krok.

## Zdroje (čti v tomhle pořadí, jen co potřebuješ)

1. `docs/won-discounts-build-log.md` — jediný stav běhu (Aktuální stav, Checkpointy MVP, Poučení).
2. `docs/won-discounts/prompt-pokracovani-inline.md` — **technická pravidla, zakázané věci, kdy se zastavit**. Platí dál celý.
3. `docs/won-discounts/prompt-orchestrator.md` — MVP žebřík (řádek MVP 5 = obsah a exit kritéria), brána.
4. `docs/won-discounts/rozhodnuti.md` (neměnit), `docs/won-discounts/mezery.md`, `docs/won-discounts-mvp-plan.md` (§4.4 Výprodej, §7, §10).
5. `docs/plans/2026-10-01-won-discounts-mvp4.md` — vzor plánu s kontrakty (R1–R9).
6. `docs/won-discounts/audits/audit-mvp4.md`, README funkce `apps/won-discounts/extensions/won-discounts-engine/README.md`.
7. Runbook E2E: `apps/won-discounts/scripts/e2e/runbook/README.md`. Měření rozpočtu:
   `apps/won-discounts/extensions/won-discounts-engine/tests/budget-families/README.md`.

Priorita při rozporu: `rozhodnuti.md` > `mezery.md` > `prompt-orchestrator.md` > `prompt-pokracovani-inline.md` > tento soubor > build log > plány.

## Část A — ověření MVP 4 (nezávislé, ne „věřím checkpointu“)

Cíl: potvrdit, že stav na `main` odpovídá checkpointu MVP 4, a najít, co minulá session přehlédla. Každý bod zapiš
do build logu jako ✓ / ✗ s důkazem (výstup příkazu, cesta k evidenci).

- **A1 Stav repa:** `git status`, `git log origin/main..HEAD` (má být prázdné), checkpoint MVP 4 v build logu existuje.
  Necommitnuté cizí změny (`docs/product-roadmap.html` Companion, `docs/won-companion/`, `docs/won-discounts/paralelizace.md`)
  **nech být a necommituj** (roadmapu měň jen svůj řádek trikem s blobem z HEAD, viz MVP 3/4 v build logu).
- **A2 Brána:** `bash apps/won-discounts/scripts/e2e/runbook/gate.sh <scratchpad>/gate-a2` → všech 7 příkazů exit 0.
- **A3 Audit proti kódu:** pro každý nález v `audit-mvp4.md` (E1–E5, F1–F3, P1–P2, L1, A1, R1–R2, V1, D1) najdi opravu
  v kódu (soubor:řádek) a test, který ji hlídá. U 3 náhodně vybraných oprav udělej mutační kontrolu (oprava dočasně
  pryč → test musí spadnout → vrátit, ověř `git diff` prázdný). Co nesedí, je nový nález.
- **A4 Shoda Rust ↔ TS:** v bráně běží fixtures + náhodná parita; navíc `node apps/won-discounts/extensions/won-discounts-engine/tests/replay-logs.mjs`
  (porovnej dva buildy dle README funkce) — žádný nový rozdíl proti logu mimo vysvětlené.
- **A5 Živé E2E odměn** (spustí `shopify app dev`; viz runbook): Free `profile.sh rewards mvp4-verify free`,
  `profile.sh rewards-other mvp4-verify free`; pak restart app dev s Pro a `profile.sh rewards-pro mvp4-verify pro`.
  Evidence do scratchpadu (`EVID=<scratchpad>/mvp4-verify`), **ne do repa** (evidence MVP 4 už je commitnutá).
  Očekávání: ✓ Horizon ✓ Dawn, 0 opakovaných testů. Opakovaný test = najdi příčinu (v MVP 4 to byly 3× skutečné chyby).
- **A6 Uzavření ověření:** shrnutí do build logu („Ověření MVP 4 (datum): …“). Nové nálezy oprav (test červeně první),
  commitni, pushni. Teprve pak část B.

## Část B — MVP 5: Výprodej (Pro)

Obsah a exit kritéria: `prompt-orchestrator.md` (řádek MVP 5) a spec §4.4. Shrnutí: kvóta na **existující variantě**
(`price` + `compare_at_price`), ceníky trhů vč. pevných cen (A5), storna/vratky vrací kus, návrat ceny po vyčerpání nebo
datu, historie kroků, scheduler (i pro úklid historie a srovnání nákupních cen — dluh z MVP 2/3, viz „Parkované otázky
a dluh“ v build logu). Celý modul je Pro (Free: neaktivní, nikdy nerozšíří slevu — BILL-1).

Smyčka (stejná jako MVP 3/4, podrobně v `prompt-pokracovani-inline.md`, „Jak pracuješ“):

1. **B0 — rozpočet instrukcí jako první** (audit MVP 4 R1: rezerva < 1 bod, 99,32 %). Rozbal
   `.superpowers/sdd/2026-10-01-won-discounts-mvp4/budget-families-cap550.tar.gz` do scratchpadu a změř aktuální Wasm
   (`tests/budget-families/batch.mjs`). Každá změna funkce v MVP 5 (čtení výprodejových dat per řádek) se přeměří na
   těchto rodinách; ≥ 100 % = zaveď mez (jako strop úrovní 550 B) a zapiš ji do specu. Stop-pravidlo hledání stanov předem.
2. **Plán** `docs/plans/<datum>-won-discounts-mvp5.md`: cíl, Global Constraints, **kontrakty** (config výprodeje, metafieldy,
   zápisy cen do Shopify a jejich vrácení, scheduler, webhooky storen/vratek, view modely adminu, storefront config),
   úkoly po vrstvách, živá fakta k ověření. Commit **před** implementací.
3. **Vrstvy** core → Rust → sync/scheduler → storefront → admin → docs → E2E; každá vrstva = commit se zelenými testy.
   **Testy červeně první** a **po každé vrstvě celý `npm run test:unit -w won-discounts`** (ne jen cílené testy — v MVP 4
   tak dvakrát prošla červená brána bez povšimnutí).
4. **Zápisy cen do Shopify** jen skriptem v `apps/won-discounts/scripts/**` s `--dry-run` napřed a **zálohou původních
   `price` / `compare_at_price` / pevných cen v cenících**; po E2E vše vrátit a ověřit (dry-run výpis + 3 reálné záznamy).
   Katalog `won-e2e-*` — nové produkty nezakládej.
5. **Brána** (`runbook/gate.sh`), **živé E2E** Free (výprodej se nespouští) + Pro na Horizon i Dawn (`runbook/profile.sh`,
   `phase-b.sh` rozšiř o nový profil), **regrese** všech profilů MVP 1–4, **vizuální QA** 390 + 1440 (admin harness i
   storefront, je-li plocha), **audit** `docs/won-discounts/audits/audit-mvp5.md` podle `.claude/agents/won-auditor.md`
   + shoda Rust↔TS + rozpočet → oprav všechny nálezy → znovu brána + dotčené E2E → self-audit, roadmapa (jen svůj řádek),
   checkpoint MVP 5 v build logu, commit + `git push origin main`.

## Poučení z MVP 3–4, která musíš držet

- **Nepouštěj `prettier`** — repo nemá prettier config; přeformátuje soubory na 80 znaků. Formátuj podle okolí. Před
  commitem `git diff --stat`: nečekaně velké číslo = přeformátování, vrať to.
- **Nikdy neměň `apps/won-discounts/extensions/**` během běžícího `shopify app dev`** (přestavba rozbije dev assety); po
  změně extensionu restart app dev. README uvnitř `extensions/` platí taky.
- **E2E, které zapisuje do košíku přes `Shopify.actions.updateCart`**, běží na doméně storu s `?preview_theme_id=` tématu
  „Horizon“/„Dawn“ (theme dev proxy neobsluhuje Storefront API). Doména storu má rate limit Cloudflaru (429) → pauzy,
  opakování 429 je v `gotoStorefront` a košíkových helperech. Cookie lištu odmítnout, preview bar skrýt (vzor ve
  `storefront.rewards.spec.ts`).
- **Storefront Events:** `shopify:cart:*` se vysílá na začátku změny → čekat na `event.promise`; `/cart.js` číst
  `cache: "no-store"`; reakce v jedné frontě; nikdy slepé opakování zápisu (ztracená odpověď = dvojí zápis).
- **Dawn** má `html { font-size: 62.5% }` → minimální velikosti v `px`. Košík Dawnu na dev storu je „notification“ (bez draweru).
- **JS storefrontu** ≤ 10 240 B gz dohromady (zbývá ~14 B!) — nový storefront kód znamená nejdřív uvolnit místo.
- **Wasm** < 256 000 B (dnes 245 237 B), dotaz funkce ≤ 3 000 znaků, config funkce ≤ 9 000 B.
- **Opakovaný (flaky) test je nález**, ne šum: dohledej příčinu, než ho přijmeš (v MVP 4 3× skutečná chyba, 2× časování).
- Heslo storefrontu jen v `apps/won-discounts/.env` (čte ho E2E loader); nikdy ho nepiš jinam, nevypisuj `.env*`,
  `shpat.md`, `.auth/`, `prisma/dev.sqlite` ani celý log `shopify app dev`.

## Zakázané (z `prompt-pokracovani-inline.md`, připomenutí)

`shopify app deploy`, `fly deploy`, publikace témat, jiný store než `b2b-b2c-store-development.myshopify.com`,
přihlášení do Shopify adminu v prohlížeči, commit tokenů/hesel/`.env`/`.auth/`/lokálních DB, změna `rozhodnuti.md`,
změny mimo `apps/won-discounts/**`, `packages/**`, `docs/**`, `tests/**` (`apps/b2b-companion`, `apps/won-toasts` jen čti).

## Kdy se zastavit a zeptat

Selže primární cesta i schválený fallback; chybí předpoklad, který neumíš zajistit (CLI login, `config:link`, přístup);
stejná brána selže 3× po sobě se stejnou příčinou; produktové rozhodnutí, které `rozhodnuti.md` neřeší a nejde vyřešit
volbou s výchozí hodnotou (výchozí volby zapiš do plánu jako „rozhodnuto výchozí hodnotou“). Zastavení: zapiš do build
logu co / proč / co potřebuješ a dej Ondřejovi přesný příkaz nebo otázku s doporučenou odpovědí.

## Report Ondřejovi (na konci, česky, pod ~1 200 znaků)

1. Jedna věta: co je hotové (ověření MVP 4, MVP 5).
2. Odrážky s `soubor:řádek` / commitem: nálezy ověření MVP 4, co MVP 5 přineslo, důkazy (brána, E2E ✓✓, evidence).
3. Co zůstalo neověřené a co má Ondřej zkontrolovat sám — s přesným příkazem do terminálu.
