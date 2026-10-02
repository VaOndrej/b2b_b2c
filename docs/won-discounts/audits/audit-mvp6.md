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
