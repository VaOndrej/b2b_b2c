# Won Discounts MVP 6.1 — kampaně mění i množstevní slevy (implementační plán, inline)

> Zadání: [`../won-discounts/prompt-mvp7.md`](../won-discounts/prompt-mvp7.md) (rozhodnutí Ondřeje 2026-10-04, bod 2).
> Navazuje na [`2026-10-02-won-discounts-mvp6.md`](2026-10-02-won-discounts-mvp6.md) (K1–K9, D1–D6; D1 se tímto mění).
> Stav: [`../won-discounts-build-log.md`](../won-discounts-build-log.md). Práce **inline bez subagentů**.

**Goal:** Kampaň (Pro) smí přepsat úrovně sady množstevních slev. Přepis je pro každé množství a měnu **stejně nebo
víc štědrý** než základ (jinak admin neuloží, sync nepošle). V okně kampaně dává pokladna kampaňové úrovně; tabulka na
stránce produktu se přepne na kampaňové **minutu po startu** a zpět na základní **7 minut před koncem**, takže web
nikdy neslíbí víc než pokladna. Dárky kampaň nemění (admin to říká).

**Architecture:** Funkce pro živou kampaň (handshake `campaignId` + `varsVersion` + okno) čte kompaktní sady z
`campaigns[0].tiers` **místo** `modules.tiers` — nikdy obojí. Obě části mají vlastní strop 550 B. Storefront config
nese vždy to, co se má ukázat (`tiers`), a základ vedle (`bt`) jen po dobu, kdy ukazuje kampaň; rozšíření tématu se
nemění (JS rozpočet beze změny). Přepíná scheduler `campaigns.due` přes hranice `campaignBoundary`.

## Global Constraints

- Vše z plánu MVP 6 (dev store, žádný deploy, povolené cesty, žádný prettier, extensions neměnit při běžícím
  `shopify app dev`, testy červeně první, po každé vrstvě celý `npm run test:unit -w won-discounts`, vrstva = commit).
- **Fail closed:** přepis, který není aspoň tak štědrý jako základ (seed, import, pozdější úprava základní sady), se
  do funkce ani na web **nepošle** — platí základ; admin ho vypíše jako nepoužitý.
- **BILL-1:** ve Free doběhnuvší kampaň nesmí oživit sadu, kterou gate vypnul (přepisy zúžených sad gate odstraní).
- Rozpočty: config ≤ 9 000 B v nejhorším stavu, `modules.tiers` ≤ 550 B **a** `campaigns[0].tiers` ≤ 550 B, dotaz
  30/30 a 3 000 znaků beze změny, Wasm < 256 000 B, instrukce podle B0.

## Rozhodnuto výchozí hodnotou

- **E1 — přepis = jen `breaks`.** `countAcross` kampaň nemění (jiné počítání není „víc štědré“ pro každý košík);
  uložený `patch.countAcross` se nepoužije a admin ho vypíše mezi nepoužitými.
- **E2 — „stejně nebo víc štědré“** se měří po měnách (každá měna jmenovaná v základu nebo přepisu + „měna bez
  částek“) v každém bodě zlomu obou sad: dosažená úroveň základu `B(q)` a přepisu `C(q)`. `B(q)` žádná → v pořádku.
  Jinak `C(q)` musí být a být stejného druhu: procenta ≥ procenta, částka ≥ částka v té měně. Procenta proti částce
  se neporovnávají (záleží na ceně) → chyba „stejný druh slevy jako základ“.
- **E3 — zpoždění a předstih:** tabulka na PDP kampaňová od `start + 60 s` do `end − 420 s`. Předstih 7 min =
  takt scheduleru (≤ 60 s) + selhaný resync a jeho zopakování za 5 min (`CAMPAIGNS_RETRY_MS`) + sync. (První návrh
  byl 180 s; `campaigns.due` ale selhaný resync opakuje až za 5 min, takže by se jedno zopakování nevešlo —
  opraveno před implementací syncu.) Kampaň kratší než 8 min tabulku nepřepne. Zbytkové riziko: sync selhává déle
  než 7 min před koncem (výpadek Shopify) → tabulka zůstane kampaňová; admin ukazuje selhaný sync.
- **E4 — kill switch a přepnutí verze kampaně:** než sync zapíše shop config, který kampaň ruší nebo mění, vrátí
  na webu základní tabulku (krok `storefront_config.campaign_off`: živý storefront config s `tiers := bt`). Selhání
  kroku kill switch nezastaví (záznam v běhu).
- **E5 — tip „přidej 1 ks“ a plán košíku** (app proxy) počítají jako funkce právě teď (K6 MVP 6) — beze změny.

## Kontrakty (zafixované před implementací)

**L1 — config (beze změny tvaru).** `Campaign.overrides[] = {ruleId: <id sady>, patch: {breaks: TierBreak[]}}`
(sanitizer to přijímá od MVP 0, hodnoty jdou přes `sanitizeTierSet`).

**L2 — core `campaign-tiers.ts`.**
- `tierOverrideIssue(base: TierSet, breaks: TierBreak[]): null | {kind: "less" | "kind" | "empty", minQty: number,
  currency: string | null}` (E2; `empty` = přepis bez platné úrovně).
- `campaignTierSets(tiers: TiersModule, campaign): {sets: TierSet[]; applied: string[]; unused: string[]}` — sady s
  použitými přepisy (pořadí přepisů, poslední vyhrává; jen dosažitelné sady, jen `breaks`, jen když
  `tierOverrideIssue` = null); `unused` = id sad, jejichž přepis se nepoužil.
- `campaignTiersPayload(tiers, campaign): FunctionTiersPayload | null` — `buildTiersPayload` nad `sets`; `null`, když
  se nepoužil žádný přepis (kampaň pak `tiers` nenese).
- `CAMPAIGN_TIERS = {showDelaySeconds: 60, hideLeadSeconds: 420}`, `campaignTiersShownAt(config, now): string | null`
  — id vybrané kampaně, když má použitý přepis a `start + 60 s ≤ now < end − 420 s`, jinak `null`.

**L3 — payload (`function-payload.ts`).** `FunctionCampaign.tiers?: FunctionTiersPayload` (jen s použitým přepisem).
`EncodedShopFunctionConfig.tiers.bytes` = větší z obou částí; `fits` vyžaduje obě ≤ 550 B;
`buildShopFunctionConfigWorstCase` měří každou živou kampaň. `overrides` dál jen přepisy pravidel.

**L4 — engine (TS `plan.ts` + Rust, port 1:1).** Zdroj sad: když `activeCampaign(config, cart)` není null a záznam
té kampaně má `tiers`, které je objekt (ne pole, ne null) → `readTiersPayload(campaign.tiers)`; jinak
`readTiersPayload(modules.tiers)`. Čte se právě jedna část. Rozbitý objekt (`sets` není pole) = žádné sady (fail
closed). Rust: `Config::read_in` dostane kampaň uzlu (id + verze, jen když je okno živé) a vybere část před čtením sad.

**L5 — gate (`plan-gate.ts`).** Free + doběhnuvší kampaň: přepisy sad, které gate zúžil (zúžené sady → inertní,
další globální sady), se z kampaně odstraní; přepis ponechané globální sady zůstává.

**L6 — storefront config (`storefront-config.ts`).** Volba `campaignId: string | null` (z `campaignTiersShownAt`
nad gated configem). S kampaní: `tiers` = sady kampaně, `bt` = základní `{global, sets}`, `tc` = id kampaně. Bez
kampaně `bt` ani `tc` nejsou. Liquid ani JS se nemění.

**L7 — sync + scheduler.** `campaignBoundary(config, now)` = nejbližší z {`end`; u kampaně s použitým přepisem navíc
`start + 60 s` a `end − 420 s`, pokud jsou v budoucnu a `start + 60 s < end − 420 s`}. Krok 4b staví storefront
config s `campaignId = campaignTiersShownAt(payloadConfig, nowLocal)`. Nový krok před P1 / finálním zápisem
(`storefront_config.campaign_off`, E4): živý storefront config má `bt` a tento běh by ukázal jiné `tiers` nebo
jinou / žádnou kampaň → zápis živého configu s `tiers := bt` bez `bt` a `tc`, read-back.

**L8 — admin.** Editor kampaně: sekce „Množstevní slevy v kampani“ — u každé dosažitelné sady přepínač a úrovně
(množství + hodnota, předvyplněné základem); chyby u pole (`campaign.error.tierLess` s množstvím a měnou,
`tierKind`, `tierEmpty`, `tierSet`); kampaň smí mít jen přepisy sad (bez pravidel). Věta „Dárky kampaň nemění.“ a
„Tabulka na stránce produktu se přepne minutu po začátku a 7 minut před koncem zpět.“ `CampaignView` +
`tiers: {setId, label, breaks: string[]}[]`, `unused` počítá i nepoužité přepisy sad. Draft
`CampaignDraft.tiers?: {setId: string; breaks: TierBreak[]}[]`.

**L9 — docs.** `concepts/campaigns.md`, `tasks/create-a-campaign.md`, `support/campaign-did-not-start.md` (tabulka
se přepíná se zpožděním), Free vs Pro beze změny.

**L10 — E2E.** Profil `campaign-tiers` (Pro): globální sada „od 2 ks −10 %“, kampaň „od 2 ks −20 %“, okno
`teď + 3 min` až `teď + 15 min`. Před startem: PDP tabulka 10 %, `/cart.js` 2 ks = 10 %. Start + 90 s: tabulka
20 %, `/cart.js` 20 %, pokladna Bogus 20 %. `end − 5 min`: tabulka 10 %, `/cart.js` stále 20 %. Po konci: 10 %.
Free: celý čas 10 %. Horizon i Dawn. Regrese `campaign`, `tiers`, `tiers-pro`.

## Rozpočet — B0 (stop-pravidlo zapsané před měřením)

Funkce se mění (L4), proto se měří **build s L4**, ne `main`. Co se má potvrdit: živá kampaň se sadami čte stejně
bajtů sad jako základ (≤ 550 B), nečtená základní část stojí jen průchod poskytovatele vstupu a vytlačuje výplň.

**Měření (jeden průchod, bez šplhání):** rodiny cap 550 (`budget-families-cap550.tar.gz`, 3 320 vstupů) → základ
`outlet-flag-variants.mjs` `MODES=none` (tvar dnešního dotazu) → `campaign-variants.mjs` s režimy:
- `none`, `value`, `retarget` (jako MVP 6 — přeměřit, funkce se změnila);
- `tiers` — kampaň nese `tiers` = `modules.tiers` vstupu se zvednutými hodnotami (stejná velikost), bez přepisů
  pravidel;
- `tiers-retarget` — `tiers` + přepisy `target`, kolik se vejde do 9 000 B.
Vstupy, jejichž config by přesáhl 9 000 B, nejsou možné a do brány se nepočítají (`OUT`).

**Stop-pravidlo:** max < 100 % a 0 DIFF (parita TS) → bez nové meze. Max ≥ 100 % v režimech `tiers*` → mez:
`bajty(modules.tiers) + bajty(campaigns[0].tiers) ≤ 550` (společný strop místo dvou), zapsat do specu a přeměřit jen
`tiers*` jednou. Max ≥ 100 % v `none` / `value` / `retarget` (regrese proti MVP 6: 99,86 %) → vrátit výběr části do
tvaru bez nákladu pro kampaň bez sad a přeměřit. DIFF → chyba enginu, opravit dřív než cokoli dalšího.

## Výsledek B0 (2026-10-04, build MVP 6.1, Wasm 249 111 B, sha1 2bdc0c27…)

| Sada | Běhů | Platných | Max | ≥ 100 % | DIFF |
|---|---|---|---|---|---|
| základ (rodiny cap 550 × `wonOutlet` none, tvar dnešního dotazu) | 3 320 | 3 320 | 99,83 % | 0 | 0 |
| kampaň `none` | 3 320 | 1 330 | 99,58 % | 0 | 0 |
| kampaň `value` (0–9 přepisů) | 3 320 | 1 330 | 99,58 % | 0 | 0 |
| kampaň `retarget` (0–11 přepisů) | 3 320 | 1 330 | **99,90 %** | 0 | 0 |
| kampaň `tiers` (sady kampaně ≤ 544 B místo základních) | 3 320 | 3 269 | 98,77 % | 0 | 0 |
| kampaň `tiers-retarget` (sady + 0–6 přepisů `target`) | 3 320 | 3 269 | 99,31 % | 0 | 0 |

„Platných“ = config ≤ 9 000 B (ostatní admin neuloží; informativně max 99,86 %). Režimy `tiers*` berou místo pro
sady kampaně z `marketCountries` (59 090 odebraných položek), proto mají víc platných vstupů a nižší maximum.

**Stop-pravidlo splněno:** max < 100 %, 0 DIFF → **bez nové meze**, dva samostatné stropy 550 B zůstávají. Proti
buildu MVP 6 stojí stejné vstupy o 0,03–0,04 bodu víc (základ 99,80 → 99,83 %, `retarget` 99,86 → 99,90 %): výběr
části se sadami při čtení configu. Rezerva živé kampaně je **0,10 bodu** (byla 0,14), bez kampaně 0,17. Velikost
Wasm +3 614 B (245 497 → 249 111 B, zbývá 6 889 B do 256 000 B).

## Úkoly po vrstvách

0. Plán + kontrakty → commit.
1. **Core:** L2, L3, L5, L6, L7 (`campaignBoundary`), L4 v TS (`plan.ts`), validace draftu (L8). Testy červeně první.
2. **Rust:** L4, fixtures z TS (živá kampaň se sadami / mimo okno / nesedí verze / rozbité `tiers` / kampaň bez
   `tiers`), unit testy + dvojčata, parita (generátor sad s kampaní), replay, velikost Wasm, **B0** → výsledek sem.
3. **Sync + scheduler:** L7 (4b s kampaní, `campaign_off`, hranice).
4. **Storefront:** jen contract test, že rozšíření čte `tiers` (beze změny kódu).
5. **Admin:** L8 + harness + cs/en + screenshoty 390/1440.
6. **Docs:** L9. 7. **E2E:** L10. 8. Brána, audit (sekce 6.1 v `audit-mvp6.md`), checkpoint, commit + push.
