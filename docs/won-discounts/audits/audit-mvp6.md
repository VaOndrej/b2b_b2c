# Audit MVP 6 — Kampaně (2026-10-02)

Rozsah: `git log 465c827^..HEAD` (plán K1–K9 + D1–D6, B0 rozpočet, core `campaigns.ts` + payload + gate, sync K3–K5
+ scheduler `campaigns.due` + migrace, embed K6, admin K7, docs K8, E2E K9). Způsob: inline podle
`.claude/agents/won-auditor.md` (findings-first, P0–P3, důkaz soubor:řádek), plus kontrola shody Rust ↔ TS a rozpočtu.

## Findings

Žádný P0 ani P1.

### Nalezené během stavby

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| S1 | P1 (postup) | První průchod B0 na surových vstupech rodin (bez `wonOutlet`) ukázal 101,7 % — měřil nemožné vstupy, ne kampaň (kampaň +0,02 bodu) | plán MVP 6 „Oprava postupu“, `scratchpad/budget/camp.tsv` vs `base.tsv` | platný průchod přes `outlet-flag-variants` (99,80 % základ, 99,86 % kampaň); postup zapsaný do plánu |
| S2 | P2 | Sync gatoval kampaně pro Free bez ohledu na downgrade; běžící kampaň by po přechodu na Free zmizela uprostřed okna (A6) | `plan-gate.ts` „strips campaigns outright“ | K3: `finishing` v gate, `ShopSyncState.campaignsFinishing`, test „K3: a downgrade lets the running campaign finish“ |
| S3 | P2 | Dluh MVP 2: fáze 1 přepnutí kampaně posílala NOVÁ pravidla ještě před finálním zápisem (zadržený zápis je nechal živé) | `sync.server.ts` `phaseOnePayload` | K5: fáze 1 = živý config bez kampaně (`liveWithoutCampaign`), fallback jen bez živého / přes rozpočet; 2 testy |
| S4 | P2 | Embed v košíku plánoval bez kampaně → v okně by košík ukazoval jinou slevu než pokladna | `cart-plan.server.ts` „campaigns not applied yet“ | K6: kampaň z živého configu + místní čas obchodu; test na hranicích (start včetně, konec bez) |
| S5 | P3 | 390 px: pole času v mřížce `1fr 8rem` přetékala | screenshot `campaigns-pro-390` (první verze) | `minmax(0, 2fr) minmax(0, 1fr)`, přefoceno bez přetečení |

### Audit

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| C1 | P2 | Zadržené přepnutí kampaně (`campaign_switch_held`) scheduler nezopakoval, pokud předtím nebyla zapsaná hranice (první kampaň, zabitá kampaň) — K4 to sliboval | `sync.server.ts` 3 místa `pending.add("campaign_switch_held")`, `scheduler.server.ts` bere jen `campaignBoundaryAt ≤ teď` | `holdSwitch()` zapíše hranici teď + 5 min (`CAMPAIGN_HELD_RETRY_MS`); test v „K5: a held switch…“ |
| C2 | P2 | Úprava běžící kampaně: pole začátku mělo `allow` od dneška, začátek běžící kampaně je v minulosti → pole neplatné | `CampaignsScreen.tsx` start `s-date-field` | `allow` jen pro novou / naplánovanou; test „audit C2“ |
| C3 | P3 | Odinstalovaný obchod s hranicí kampaně: scheduler ho bez session odkládá po 5 min, dokud `shop/redact` (≈ 48 h) nesmaže `ShopSyncState` | `scheduler.server.ts` `runCampaignsDueOnce`, `config.server.ts:492` | přijato (dávka 20, žádné volání Shopify bez session) |
| C4 | P3 | Přehled čte navíc kontext obchodu (časové pásmo) pro kartu Kampaně | `campaigns-admin.server.ts` `loadCampaignsOverview` → `readShopContext` | přijato; čtení je stejné jako u ostatních karet, MVP 7 (Přehled) může sdílet |
| C5 | P3 | Částka v přepisu se čte se 2 desetinnými místy pro každou měnu (měna s exponentem 0 by dostala ×100) | `model/campaigns.ts` `minorFromInput(…, 2)` | přijato pro CZK / EUR (trhy dev storu); poznámka pro MVP 7 (měny obchodu) |

## Shoda Rust ↔ TS a rozpočet instrukcí

- **Funkce se nemění** (Rust beze změny, Wasm 245 497 B = MVP 5, dotazy 30/30). Payload posílá méně (jen přepisy
  pravidel, D1) — engine je dřív stejně ignoroval, výstup se nemění; fixtures, parita a replay v `test:unit` beze
  změny (94 cargo + 549 vitest).
- **B0** (stop-pravidlo předem): rodiny cap 550 × živá kampaň `none` / `value` / `retarget` — max **99,86 %**,
  0 ≥ 100 %, 0 DIFF (3 990 platných vstupů); odměny × kampaň `retarget` max 89,73 %. Rezerva živé kampaně 0,14 bodu.

## Open questions / assumptions

- **D1 (otázka pro Ondřeje):** kampaně v1 mění jen slevová pravidla; množstevní slevy a dárky běží beze změny.
  Doporučení pro další verzi: úrovně ano (jen štědřejší než základ, tabulka na PDP přepnutá schedulerem s rezervou),
  dárky ne (dárek je skutečný řádek košíku, po konci kampaně by ho pokladna účtovala).
- **F-K1** (okraj konce okna): Free E2E potvrzuje, že nic nenaskočí; Pro E2E zaznamená poslední čtení s kampaní a
  první bez ní (evidence `campaign-pro-*.json`).

## Overall risk summary

Kampaně stojí na mechanice z MVP 1 (handshake `varsVersion`, 3fázové přepnutí), kterou MVP 6 poprvé pouští k
merchantovi. Kritická cesta startu a konce je ve funkci (C4), scheduler jen uklízí a přepíná na další kampaň.
Největší riziko je produktové (D1: kampaň nemění úrovně a dárky) a provozní (zadržené přepnutí se opakuje po 5 min).

## Testing gaps

- Downgrade naživo (A6) jen testy syncu a gate — přepnutí plánu ve Free/Pro na dev storu by vyžadovalo billing (MVP 7).
- Kill switch naživo: integrační test (živý config bez kampaně hned po uložení), živě jen přes `campaign.mjs --remove`.

---

# MVP 6.1 — kampaně mění i množstevní slevy (audit, 2026-10-04)

Rozsah: `git log 73bc7bf..fc9567a` (core `fc949f1`, Rust + B0 `d7d6f63`, sync `dc28dcb`, admin + docs + E2E
`07995a3`, oprava z živého E2E `fc9567a`). Plán `docs/plans/2026-10-04-won-discounts-mvp6-1.md` (L1–L10, E1–E5).
Postup podle `.claude/agents/won-auditor.md` (findings-first), inline.

## Findings

| # | Sev. | Nález | Důkaz | Stav |
|---|---|---|---|---|
| T1 | **P1** | Produkční wiring syncu zahazoval `campaignId` → tabulka na PDP se v kampani **nikdy nepřepnula** (pokladna dávala 20 %, web sliboval 10 % — bezpečný směr, ale funkce nefungovala). Unit testy to nechytily: běžely přes testovací buildery, ne přes `productionSyncDeps`. | `app/lib/sync/wiring.server.ts` `buildStorefrontConfig`; živé E2E Pro 2× ✘ „a minute after the start the table shows the campaign's 20 %“; `SyncRun` 11:33:43 `storefront_config.write: unchanged` | **opraveno** `fc9567a` + test „production wiring: …“ (bez opravy ✗, ověřeno stashem) |
| T2 | P2 | Scheduler pouštěl minutové úlohy ob minutu: tik `setInterval(60 s)` přichází o pár ms dřív než `lastRunAt + 60 s` a úloha se přeskočila. Přepnutí tabulky by tak mohlo přijít až 2 min po hranici (plán E3 počítá s ≤ 60 s). | `app/lib/jobs/scheduler.server.ts` `runDueTasks` (`now − last < everyMs`) | **opraveno** `fc9567a` (`DUE_SLACK_MS = 5 s`) + test jitteru |
| T3 | P2 | První návrh předstihu návratu tabulky (180 s) nepočítal s tím, že `campaigns.due` opakuje selhaný resync až za 5 min — jedno zopakování by se nevešlo a web by po konci kampaně sliboval víc než pokladna. | plán E3; `CAMPAIGNS_RETRY_MS` | **opraveno před implementací syncu**: `hideLeadSeconds = 420` (`dc28dcb`) |
| T4 | P2 | Návrh kampaně, který by sanitizer sady potichu opravil (nižší sleva u vyššího množství se zahodí → „12 % od 5 ks“ by se uložilo jako „20 % od 2 ks“), se ukládal bez upozornění. | `validateCampaignDraft` → `sanitizeTierSet` (monotónní úrovně) | **opraveno** `07995a3`: chyba `campaign.error.tierBreaks` u pole, nic se neopravuje potichu |
| T5 | P3 | Sync s kampaní, která má (nebo měla) přepis sady, čte před zápisem configu navíc storefront config (1 dotaz na běh), i když je kampaň dávno skončená. | `sync.server.ts` `campaignTiersInPlay` | přijato (jeden levný dotaz; bez něj by kill switch nevrátil tabulku napřed) |
| T6 | P3 | Když merchant později zvedne základní sadu nad kampaňovou, přepis se přestane uplatňovat potichu — řekne to jen karta kampaně („Uložené změny, které se nepoužijí“), obrazovka Množstevní slevy ne. | `campaign-tiers.ts` `campaignTierSets` (fail closed) | přijato; nápověda to říká (`concepts/campaigns.md`) |
| T7 | P3 | Wasm narostl o 3 614 B (245 497 → 249 111 B) a stejné vstupy stojí o 0,03–0,04 bodu víc; rezerva živé kampaně 0,10 bodu. | README funkce „MVP 6.1“, plán „Výsledek B0“ | přijato (stop-pravidlo splněno); funkce nemá místo pro další práci na řádek |
| T8 | P3 | Tabulka zůstane kampaňová, když sync selhává déle než 7 min před koncem (výpadek Shopify). | plán E3 | přijato (admin ukazuje selhaný sync) |

0 × P0. P1 a P2 opravené s testy.

## Shoda Rust ↔ TS a rozpočet instrukcí

- **Port L4** (`Config::read_in` vybere část se sadami před čtením sad; `plan-tiers.ts` krok 8): Rust unit test +
  TS dvojče `a_live_campaigns_tier_sets_are_read_instead_of_the_base_ones` (živá / stará verze / mimo okno / jiná
  kampaň / `tiers` null, pole, řetězec / objekt bez sad / zabitý záznam před živým), 3 nové fixtures
  (`lines-campaign-tiers-*`, výstupy psané ručně, stávající fixtures beze změny), náhodná parita **1 200 košíků,
  0 rozdílů**, každá cesta výběru ≥ 20× (`campaign tier parity`), cargo 95, vitest 563.
- **B0** (stop-pravidlo předem, jeden průchod, 19 920 běhů): základ 99,83 %, kampaň `none` / `value` 99,58 %,
  `retarget` **99,90 %**, `tiers` 98,77 %, `tiers-retarget` 99,31 %; 0 ≥ 100 %, 0 DIFF → bez nové meze.

## Živé E2E (dev store, Bogus)

- **Pro `campaign-tiers` Horizon ✓** (`evidence/mvp6-1/e2e-B/evidence/campaign-tiers-pro-horizon.json`), okno
  11:59–12:11 UTC: před startem tabulka 10 % / košík 10 %; 11:59:11 košík 20 % (tabulka ještě 10 %); tabulka 20 %
  mezi 12:00:36 a 12:01:02 (start + ~2 min); pokladna 16,00 Kč místo 20,00 Kč; tabulka zpět na 10 % mezi 12:04:37
  a 12:05:03 (konec − 7 min), košík dál 20 %; po konci 10 % / 10 %. V každém čtení tabulka ≤ košík.
- **Free `campaign-tiers` ✓ Horizon ✓ Dawn** (kampaň se nikdy neuplatní, 10 % celou dobu), regrese Free
  `tiers` ✓ ✓, `campaign` ✓ ✓ (první běh: 2 testy embedu na Horizonu dostaly 401 z theme dev, spec kampaně
  prošel; opakování čisté ✓ ✓).
- **Pro `campaign-tiers` Dawn ✓** (stejný průběh, `campaign-tiers-pro-dawn.json`), regrese Pro `campaign` ✓ ✓
  (3 + 3), `tiers-pro` ✓ ✓ (5 + 5); úklid + `verify-clean` exit 0 u všech profilů.

## Testing gaps

- Kill switch s kampaňovou tabulkou naživo: jen test syncu (`campaign_off` před zápisem configu).
- Doběh kampaně se sadami ve Free po downgradu naživo: test gate + `plan-admin.test.ts` (kampaň doběhne), živě
  až s billingem (MVP 7).
