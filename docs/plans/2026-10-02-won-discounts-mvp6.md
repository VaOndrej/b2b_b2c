# Won Discounts MVP 6 — Kampaně (Pro) (implementační plán, inline)

> Spec: [`../won-discounts-mvp-plan.md`](../won-discounts-mvp-plan.md) §2 (`Campaign`), §3 (C4, transport), §4.6, §7
> (Kampaně = Pro, A6 downgrade), §10 (MVP 6). Rozhodnutí: `rozhodnuti.md` „Kampaně (Black Friday)“. Mezery A6, A8.
> Dluh: build log „Parkované otázky a dluh“ (fáze 1 přepnutí kampaně). Stav:
> [`../won-discounts-build-log.md`](../won-discounts-build-log.md). Práce **inline bez subagentů**.

**Goal:** Merchant (Pro) založí kampaň: název, okno v čase obchodu (od–do na minutu) a sadu přepisů slevových
pravidel (jiná hodnota, pravidlo zapnuté jen v kampani). Kampaň začne a skončí **atomicky** pro všechny uzly (funkce
sama pozná okno přes `shop.localTime.dateTimeBetween`, C4), po konci platí zase základní pravidla bez zásahu.
Okamžitý kill switch, zákaz překryvu, náhled košíku v době kampaně (Vyzkoušet košík), karta na Přehledu. Ve Free
kampaň nejde založit; běžící při downgradu doběhne (A6).

**Architecture:** Kampaně žijí v configu (`campaigns[]`, MVP 0) a engine je umí od MVP 1 (TS i Rust: handshake
`campaignId` + `varsVersion`, přepisy pravidel, refy `rule@k`), sync má 3fázové přepnutí. MVP 6 doplňuje: měření
rozpočtu živé kampaně (B0), přepnutí na hranici kampaně bez člověka (scheduler), downgrade, opravu fáze 1 (dluh
MVP 2), embed v košíku počítající s kampaní, admin modul a docs. **Funkce se nemění**, pokud B0 neřekne jinak.

## Global Constraints

- Vše z plánů MVP 0–5 (jen dev store, žádný deploy, povolené cesty, tajné soubory nečíst, dry-run + záloha při mých
  zápisech, žádný prettier, extensions neměnit při běžícím `shopify app dev`).
- **BILL-1 / A6:** kampaň založit, upravit nebo oživit jen Pro (server). Free: gate kampaně odřízne, **kromě těch,
  které při downgradu už běžely** (doběhnou do konce okna, nic nového). Kill switch funguje i ve Free.
- **C4 / atomicita:** start a konec jen přes okno ve funkci; scheduler je jen úklid a přepnutí na další kampaň
  (nikdy kritická cesta zapnutí nebo vypnutí).
- **A8:** překryv oken admin odmítne s chybou u pole (sanitizer starší data vypíná, admin nikdy neuloží).
- **Rozpočty:** config funkce ≤ 9 000 B v nejhorším stavu (`buildShopFunctionConfigWorstCase`, už platí), instrukce
  podle B0, dotaz 30/30 a 3 000 znaků beze změny.
- **Storefront:** stránka produktu nikdy neslíbí víc než pokladna. Kampaň mění jen slevová pravidla, která PDP
  neukazuje; košík (embed) bere plán ze serveru → musí počítat s kampaní stejně jako funkce.
- Testy červeně první, po každé vrstvě celý `npm run test:unit -w won-discounts`, každá vrstva = commit.

## Rozhodnuto výchozí hodnotou

- **D1 — přepisy jen slevových pravidel.** Engine (TS i Rust) od MVP 3 výslovně neaplikuje přepisy na sady úrovní a
  dárky („Campaign overrides never reach a tier“), sanitizer je ale přijímá. Rozšířit je = nová logika funkce při
  rezervě 0,11 bodu + storefront (tabulka úrovní na PDP, práh a dárek v košíku = skutečný řádek, který by po konci
  kampaně pokladna účtovala) bez místa v JS (rezerva ~14 B). V1: kampaň mění pravidla modulu Slevy a kódy (hodnota,
  zapnutí jen v kampani — tím vznikne „sada pravidel kampaně“, vč. pravidel na dopravu zdarma); množstevní slevy a
  dárky běží v kampani beze změny a admin to říká. Uložené přepisy sad / dárků (seed, import) se do funkce
  **neposílají** (ušetří bajty) a admin je vypíše jako nepoužité. **Otázka pro Ondřeje** (report): mají kampaně
  v další verzi měnit i množstevní slevy a prahy dárků? Doporučení: úrovně ano (jen štědřejší než základ, tabulka
  na PDP přepnutá schedulerem s rezervou na okrajích), dárky ne.
- **D2 — admin přepis pravidla = hodnota a zapnutí.** Cílení, minimum, kombinace a název kampaň v adminu v1
  nemění (engine je umí; pro admin v1 by to znamenalo celý editor pravidla v kampani). Pravidlo jen pro kampaň =
  vypnuté pravidlo, které kampaň zapne.
- **D3 — okno na minutu, čas obchodu**, `start < end`, konec nejdřív 5 minut od uložení, délka ≤ 92 dní (strop
  rozumné kampaně; delší = běžné pravidlo s plánem). Začátek v minulosti jde jen u běžící (úprava), nová kampaň
  začíná nejdřív teď.
- **D4 — úprava běžící kampaně** je povolená (hodnoty, konec); změna okna = nový `varsVersion` → sync přepne přes
  fázi 1 (na pár sekund bez kampaně, konzistentně). Admin to řekne.
- **D5 — smazání** jen kampaně, která neběží; běžící se nejdřív ukončí kill switchem. Ukončené a zabité zůstávají
  v seznamu (nejvýš 50 kampaní, `CONFIG_LIMITS.campaigns`), smazat je jde.
- **D6 — hranice `end`:** funkce bere `dateTimeBetween(start, end)`; okraj (je `end` ještě uvnitř?) není ověřený
  (`campaignInputFromVars`: start včetně, end bez). Živé E2E změří; admin ukazuje „do 23:59“ jako konec v 23:59:00.

## Kontrakty (zafixované před implementací)

**K1 — config (beze změny tvaru).** `Campaign {id, name, window: {start, end} (YYYY-MM-DDTHH:MM:SS, čas obchodu),
overrides: {ruleId, patch}[], killed}`. Admin zapisuje jen `patch.value` a `patch.enabled` (D2). Nové pole není.

**K2 — payload (core `function-payload.ts`).** Vybraná kampaň (běžící, jinak další) se posílá jen s přepisy, jejichž
`ruleId` je pravidlo (D1); přepisy sad / dárků odpadnou. `buildShopFunctionConfigWorstCase` měří totéž. Node vars
beze změny.

**K3 — gate (core `plan-gate.ts`, A6).** `gateConfigForPlan(config, "free", { now, finishing })`: `finishing` =
id kampaní, které smí doběhnout; Free ponechá **jen** je (a jen do jejich konce), ostatní odřízne jako dnes
(`stripped` je hlásí). Pro beze změny. `finishing` vzniká v syncu: při prvním syncu, který zjistí přechod Pro → Free
(`ShopSyncState.appliedPlan` = pro, plán = free), = kampaně, které v tu chvíli běží (start ≤ teď < konec, nezabité);
uloží se do `ShopSyncState.campaignsFinishing` (JSON id) a smaže, když skončí nebo se vrátí Pro.

**K4 — scheduler (`campaigns.due`, každou minutu).** `ShopSyncState.campaignBoundaryAt` (UTC) = nejbližší okamžik,
kdy se změní vybraná kampaň: konec vybrané kampaně (pak přijde další nebo žádná). Zapíše ho sync po finálním zápisu
shop configu (null = žádná kampaň). Úloha vezme obchody s `campaignBoundaryAt ≤ teď` (dávka 20) a spustí jejich
resync s offline session (bez session → zkusí příští minutu). Neúspěšný sync hranici nechá → zkusí znovu. Stejně se
zopakuje `campaign_switch_held` (pending poslední SyncRun), max. jednou za 5 minut.

**K5 — fáze 1 přepnutí (dluh MVP 2).** Fáze 1 = **živý** shop config (co je teď v Shopify) s
`campaignId: null`, `campaignVarsVersion: null` — nic nového (pravidla, úrovně, marže) se nedostane ven, dokud
neprojde finální zápis. Bez živého configu (první sync) jako dnes (nový config bez kampaně, marže složená).

**K6 — embed v košíku (`cart-plan.server.ts`).** Kampaň pro plán = z živého shop configu: `id = campaignId`,
`varsVersion = campaignVarsVersion`, `active` = místní čas obchodu (`YYYY-MM-DDTHH:MM:SS` z `ianaTimezone`) v okně
vybrané kampaně (`campaigns[0].window`, start včetně, end bez). Stejná pravidla jako funkce, kde uzly mají vars
vybrané kampaně (po fázi 3 vždy).

**K7 — admin.** Route `/app/campaigns` (statická, nahradí ComingSoon), obrazovka `CampaignsScreen`:
1. Nová / upravit kampaň: název, začátek a konec (datum + čas), seznam pravidel s přepisem (pravidlo, zapnuté
   v kampani ano/ne, nová hodnota: % nebo částka per měna podle typu pravidla); chyby u polí (okno, překryv s
   „X“, D3, pravidlo neexistuje); rozpočet configu (stejná hláška jako editor pravidla). Free: zamčeno amber (§16).
2. Seznam: běží / naplánované / skončené / ukončené ručně, u každé okno v čase obchodu, počet přepisů, stav propsání
   (sync), tlačítka Upravit, Ukončit hned (kill), Smazat (D5), „Vyzkoušet košík v době kampaně“ (odkaz na
   Vyzkoušet košík s datem a časem začátku + 1 min).
3. Upozornění: nepoužité přepisy sad / dárků (D1), kampaň ve Free doběhne (A6).
Přehled: karta „Kampaně“ (běží X / další od … / žádná). Vyzkoušet košík: pole času (HH:MM) vedle data.
View model `CampaignView {id, name, start, end (formátované), status: "running"|"scheduled"|"ended"|"killed",
overrides: {ruleId, ruleName, enabled?, value?}[], unused: number, finishing: boolean}`; akce `intent`
`save | kill | delete`, formulář parsuje server (SEC-1), plán kontroluje server (BILL-1).

**K8 — docs.** concept `campaigns.md`, task `create-a-campaign.md`, support `campaign-did-not-start.md`; Free vs Pro.

**K9 — E2E.** Profil `campaign`: automatická sleva 10 % na `won-e2e-simple-a`, kampaň přepíše na 30 %, okno
`teď + 3 min` až `teď + 7 min` (čas obchodu, zapisuje seed přes app). Pro: `/cart.js` před startem 10 %, v okně
30 %, po konci 10 % (polling po 20 s, Cloudflare tempo), pokladna v okně = 30 %; Free: celý čas 10 % (kampaň
odříznutá), admin ji nedovolí založit. Horizon i Dawn (dvě okna za sebou, druhé po prvním). Regrese MVP 1–5 profilů.

## Úkoly po vrstvách

0. **B0** rozpočet (níž) → výsledek do tohoto plánu → commit.
1. **Core:** K2 (filtr přepisů), K3 (`finishing`), `campaignBoundary(config, nowLocal)`, `campaignInputFromShopConfig`
   (K6), admin validace `validateCampaignDraft` (D3, překryv, pravidla), stav kampaně v čase `campaignStatusAt`.
2. **Rust:** nic (B0 bez nálezu) — jen přeměřit, kdyby se payload měnil.
3. **Sync + scheduler:** K5, `campaignBoundaryAt` + `campaignsFinishing` (migrace), `campaigns.due`.
4. **Storefront (server):** K6.
5. **Admin:** K7 + harness + i18n + screenshoty 390/1440.
6. **Docs:** K8. 7. **E2E:** K9. 8. Brána, audit, roadmapa, checkpoint.

## Živá fakta k ověření

- F-K1: okraj `dateTimeBetween` na konci (D6) — E2E zaznamená poslední běh před koncem a první po něm.
- F-K2: přepnutí uzlů při kill switchi (jen shop config) — sleva v `/cart.js` do 1 min bez přestavby.

## Rozpočet — kampaně (B0, stop-pravidlo zapsané před měřením)

Co je dnes (MVP 1–5): engine TS i Rust umí kampaň (handshake `campaignId` + `varsVersion`, přepisy pravidel,
re-target refy `rule@k`), ale **živá kampaň nikdy neprošla měřením rozpočtu instrukcí** — všechny rodiny mají
`campaignActive: false`. Rezerva po MVP 5: 0,11 bodu (99,89 %).

**Měření (jeden průchod, bez šplhání):** všech 3 320 vstupů rodin cap 550 (`budget-families-cap550.tar.gz`)
× 3 režimy `tests/budget-families/campaign-variants.mjs` = 9 960 běhů na Wasm dnešního `main` (bez změny funkce):
- `none` — kampaň živá a platná, bez přepisu (handshake + smyčka resolve);
- `value` — přepisy `value` nejodkazovanějších pravidel, kolik se vejde do 9 000 B configu;
- `retarget` — přepisy `target` nejodkazovanějších pravidel, kolik se vejde; refy řádků na ně → `rule@k`.

**Stop-pravidlo:** max < 100 % a 0 DIFF (parita TS) → kampaně bez nové meze, funkce se pro přepisy pravidel nemění.
Max ≥ 100 % → mez v syncu / adminu (strop počtu přepisů s re-targetem nebo počtu `rule@k` refů na produkt) zapsaná do
specu, přeměřit jen dotčený režim jednou. DIFF → chyba enginu, opravit dřív než cokoli dalšího.
Každá pozdější změna logiky funkce v MVP 6 (např. přepisy sad úrovní) se přeměří stejnou sadou.

**Oprava postupu (první průchod, 2026-10-02):** první průchod běžel na **surových** vstupech rodin (bez pole
`wonOutlet`, které dnešní dotaz vrací na každém řádku) — ty jsou menší než skutečný vstup, ořez na limit u nich
nebere refy a už **bez kampaně** dávají 101,66 % (MVP 5 je proto měřil přes `outlet-flag-variants.mjs`, max 99,80 %).
Kampaň na nich přidala +0,02 bodu (101,66 → 101,68 %, 3 nejhorší vstupy, stejný vstup s/bez kampaně). Platný
průchod = základ `outlet-flag-variants.mjs` (`MODES=none`, tvar dnešního dotazu) → `campaign-variants.mjs`; vstupy,
jejichž config by s kampaní přesáhl 9 000 B (`OUT`), nejsou možné (admin by je neuložil) a do brány se nepočítají.
