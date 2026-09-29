# Won Discounts — build log (autonomní běh)

Jediný stav běhu. Po kompakci kontextu nebo v nové session **začni tady** a pokračuj
od posledního nedokončeného kroku. Zadání: [`won-discounts/prompt-orchestrator.md`](won-discounts/prompt-orchestrator.md).
Spec: [`won-discounts-mvp-plan.md`](won-discounts-mvp-plan.md). Produktová rozhodnutí:
[`won-discounts/rozhodnuti.md`](won-discounts/rozhodnuti.md) (neměnit).

## Aktuální stav

- **Fáze:** MVP 1 ✅ uzavřené a pushnuté (`801d2e9`). **Další krok: MVP 2 (Ochrana marže)** —
  napsat plán `docs/plans/2026-09-29-won-discounts-mvp2.md` (skill writing-plans), SDD ledger
  `.superpowers/sdd/<plán>/progress.md`, pak smyčka MVP (TS engine + Rust + shoda, sync, UI, živé E2E).
  Nákupní ceny e2e produktů: **vyřešeno bez tokenu** (2026-09-29, `shopify app execute` jménem
  appky, stávající scopy): čtení `variant.inventoryItem.unitCost` funguje s `read_products`
  (bez `read_inventory`), zápis přes `productVariantsBulkUpdate(variants: [{ inventoryItem: { cost } }])`
  s `write_products` (bez `write_inventory`; `inventoryItemUpdate` by write_inventory chtěl).
  Důkaz: won-e2e-simple-a (varianta 48468678902001, cena 10.00 USD) má teď nákupní cenu 6.0 USD.
  Admin token (shpat) ani client secret nejsou potřeba; seed MVP 2 nastaví ceny idempotentně sám.
- **Ondřej 2026-09-29: funkce zůstává v Rustu** (JS nestačí na limit instrukcí; TS engine = reference).
- **Blokováno:** nic. Pozn.: `shopify app dev` běží s dev přepínačem `WON_DEV_PLAN=pro` z finální
  brány — před MVP 2 restartovat bez něj (dev store je Free).
- **Poslední push:** viz checkpoint MVP 1.
- **Pro Ondřeje (mimo rozsah, neřeším):** v gitu je sledovaný `apps/won-toasts/prisma/prisma/dev.sqlite`
  (lokální DB Won Toasts, může obsahovat sessions/tokeny) → doporučuju `git rm --cached` + gitignore.

## Ověřená fakta API (schema.graphql Discount Function, API 2026-04)

- `Input.enteredDiscountCodes: [EnteredDiscountCode!]!` — v run targetech jen validní,
  aktivní a pro košík způsobilé kódy (podklad C1).
- `Input.triggeringDiscountCode: String` — který kód spustil tenhle uzel (podklad C2).
- `Shop.localTime: LocalTime!` s `date`, `dateTimeBetween(startDateTime, endDateTime)`,
  `dateTimeAfter/Before` — čas jen jako porovnání s argumenty (proměnné z metafieldu přes
  `[extensions.input.variables]`), ne hodiny (podklad C4).
- `Input.localization { country, language, market (deprecated) }`, `presentmentCurrencyRate`.
- `ProductDiscountCandidateFixedAmount.amount` v měně košíku, `appliesToEachItem`.
- `Discount.discountClasses` — jeden uzel může mít PRODUCT + ORDER + SHIPPING.

## Předpoklady (ověřeno 2026-09-28)

| # | Předpoklad | Stav | Důkaz |
|---|---|---|---|
| P1 | Shopify CLI | ✓ globální `4.8.0` (`/opt/homebrew/bin/shopify`), v repu `@shopify/cli 3.92.1` (npm skripty berou lokální) | `shopify version`, `npx shopify version` |
| P1b | CLI přihlášení | ✓ uživatel `won.commerce@gmail.com` | `shopify app info` |
| P2 | `config:link -w won-discounts` | ✓ Ondřej 2026-09-28, nová appka `won-discounts`, client_id `7f200c2a…1777`. Přepis tomlu vyhodil GDPR/uninstall webhooky → vráceny z templatu + scopes + app proxy | `shopify app info` |
| P2b | Instalace na dev store | ✓ `shopify app dev --store …` → „Access scopes auto-granted: read_products, read_themes, write_discounts, write_products“ | `scratchpad/app-dev.log` |
| P2c | Admin API jménem appky | ✓ `shopify app execute` (mutace povolené jen na dev storu) — read-only dotaz vrátil shop USD / America/New_York / partnerDevelopment, slevy: `Test_Code_discount` EXPIRED, `Free gift` EXPIRED, 1× BXGY | příkaz v logu níž |
| P3 | Token v `shpat.md` | **neověřeno** — read-only dotaz `shop { name }` zablokoval bezpečnostní klasifikátor Claude Code („Credential Exploration“). Nepokoušel jsem se to obejít. | — |
| P4 | Storefront heslo | ✓ Playwright odemkl `/password` a načetl `/products/won-e2e-simple-a` (title „Won E2E — Simple A“) | `scratchpad/check-storefront.mjs`, heslo jen v `apps/won-discounts/.env` (gitignored, `git check-ignore` ✓) |
| P5 | Porty | `24678` (výchozí Vite HMR) už poslouchá jiný `node` proces → při `app dev` hlídat kolizi HMR. `9885/9886` volné pro E2E témata. | `lsof -iTCP -sTCP:LISTEN` |

## Poučení (platí pro další appky)

- **JS discount funkce nestačí na velké košíky.** Engine v JS (Javy): 200 řádků ≈ 96 M instrukcí
  při limitu 11 M, samotné čtení vstupu 12,3 M, limit padá kolem 22 řádků (2026-09-28, MVP 1 T2).
  Produkční funkce → Rust (fallback ze specu §1), TS engine zůstává referencí, shodu hlídají
  fixtures generované z TS enginu. Rust toolchain nainstalován uživatelsky (`~/.cargo`, bez
  úpravy PATH; odinstalace `rustup self uninstall`).
- **Embed v `settings_data.json` se odkazuje registračním UUID extensionu, ne `uid` z
  `shopify.extension.toml`.** Won Discounts: toml uid `7ffc5d3f…`, v `settings_data` je
  `shopify://apps/won-discounts/blocks/won_discounts_embed/01a0e790-ee4d-733c-ac8e-14c7baa03fff`.
  Lokálně (CLI, `.shopify`, `app info --json` → jen `uid` / `devUUID`) se nedá zjistit;
  jednorázově: zapnout embed v theme editoru (Ondřej, 2026-09-28) → přečíst UUID přes Admin API
  (`theme.files(config/settings_data.json)`) → overlay pro obě témata.
- **`test:unit` glob:** `tsx --test tests/**/*.test.ts` bez uvozovek tiše přeskočí `tests/*.test.ts`
  (sh bez globstar). V appce opraveno (43 → 59 testů); `_template` opravit také (Ondřej 2026-09-28: ano).

## Rozhodnutí běhu

- Nová doména v core: **`packages/core/src/discounts/`** (množné číslo). Stávající
  `packages/core/src/discount/` a `margin/` zůstávají beze změny kvůli `guard:test:core`
  b2b-companionu; nový engine z nich převezme logiku (import nebo kopie s testy), nezmění je.
- **Pořadí přesunu nativní slevy (výklad `rozhodnuti.md`, 2026-09-29):** automatické slevy jdou
  „záloha → vytvoření ve Won → smazání nativní“ (jak říká rozhodnutí); kódové slevy „záloha →
  smazání → vytvoření“, protože živě ověřeno, že vypršelý/existující kód blokuje stejný text
  (výjimka, kterou rozhodnutí samo předvídá v „Technická rizika“).
- **Ondřej 2026-09-28: všechny slevy jdou přes Won Discounts** — i slevové upsely Won
  Companion (Pro) budou pravidla ve Won Discounts, Companion vlastní slevovou funkci nemá.
  Roadmap karta Companion upravena.
- E2E porty témat: Horizon `9885`, Dawn `9886` (Toasts má 9883/9884).
- Brainstorming skill vynechán: produkt je odsouhlasený (`rozhodnuti.md`), zadání chce plnou
  autonomii bez otázek.

## Verdikty rizik C1–C6

| # | Riziko | Verdikt | Důkaz |
|---|---|---|---|
| C1 | jeden mozek | **platí** — automatický uzel (echo) viděl zadané Won kódy: 1 kód → 10 %, 2 kódy → 20 %, bez kódu 0 %; nativní kód také vidí, neexistující ne. Kódové uzly vidí oba kódy a jako `triggeringDiscountCode` svůj. **Výhrada:** mimo Plus se na řádek uplatní 1 produktová sleva; kód, jehož uzel nic nevydá, je `applicable:false` → spec §3 upraven (na řádek emituje nejvýš 1 uzel, hodnotu kódu vydává jen jeho uzel). | `docs/won-discounts/evidence/mvp0/c1-entered-codes.json`, function run logy v `app-dev.log`, report T7 |
| C2 | limit 25 | **fallback** — `discountRedeemCodeBulkAdd` funguje (`codesCount` 2), funkce pozná použitý kód, ale z jednoho uzlu se v košíku uplatní max. 1 kód. Dva kódy ze dvou uzlů na různých řádcích se uplatní oba, na stejném řádku jen jeden. → uzel na kódové pravidlo + limit aktivních kódových pravidel v adminu (přesné číslo MVP 1). | `docs/won-discounts/evidence/mvp0/c2-multi-code-node.json` |
| C3 | 10 kB metafield | **platí** — 9 000 B → 11 %, 10 000 B → 12 % (projde), 10 001 B / 10 100 B → 0 % a `InvalidVariableValueError` (config je i zdroj proměnných). Produktový metafield `{percent:7}` → 7 %. Rozpočet 9 000 B ponechán. | `docs/won-discounts/evidence/mvp0/c3-config-size.json` |
| C4 | čas ve funkci | **platí** — `dateTimeBetween` s proměnnými v čase obchodu (America/New_York): okno teď → 10 %, za hodinu → 0 %, skončené → 3 % (debug). Bez klíčů / bez metafieldu → `InvalidVariableValueError`, defaulty dotazu se **nepoužijí** → klíče povinné. | `docs/won-discounts/evidence/mvp0/c4-campaign-window.json` |
| C7 | sdílený config (MVP 1) | **platí** — 2 automatické uzly čtou app-owned shop metafield `$app:won_discounts/function_config` živě: 9 % → po změně jen shop metafieldu 13 % (první čtení, 2 s), uzly se nikdy neliší (12 vyhodnocení). 10 000 B projde; 10 100 B → `shop.metafield: null`, běh `success`, 0 % (**tiché** selhání, bez erroru); smazaný → null, 0 %. Proměnné (okno kampaně) jdou dál jen z metafieldu uzlu. Cena dotazu 24 → 27/30. | `docs/won-discounts/evidence/mvp1/c7-shop-metafield.json`, `c7-function-logs/` |
| C5 | věrný náhled | **fallback** — storefront nejde vložit do iframe: `x-frame-options: DENY` + `content-security-policy: … frame-ancestors 'none'` na `/password`, odemčeném `/products/won-e2e-simple-a` i `/cart` (i s `preview_theme_id`). Náhled v adminu = tokeny tématu (barvy, fonty, radius ze `settings_data.json` přes `read_themes`) + sdílený renderer bloků + tlačítko „Zobrazit na mém webu“ s náhledovým parametrem. | `docs/won-discounts/evidence/mvp0/c5-headers.mjs` (Playwright, odemčený storefront), `curl -sI` 2026-09-28 |
| C6 | kód při přesunu | rozhodnuto: záloha → smazání → vytvoření ve Won | `rozhodnuti.md` |

## Checkpointy MVP

### MVP 1 — Engine + Slevy a kódy + přesun nativních slev ✅ (badge → `Alpha`)

**Hotové a ověřené**
- **Engine** `@won/core/discounts` (`planCart`, emise per uzel, vysvětlení cs/en, cílení,
  sdílený payload, Pro gate `gateConfigForPlan`, rozsah minima cart/entitled, mapování výstupu
  funkce `function-output.ts`, DST-bezpečné lokální datum obchodu, strop částek).
- **Discount funkce v Rustu** (JS verze nestačila na limit instrukcí): shoda s TS enginem
  (fixtures + 2 400 náhodných košíků + TS dvojčata), 200 řádků ~7,1 M / 11 M instrukcí,
  výstup ≤ 20 kB s postupným uvolněním, Wasm 209 kB / 256 kB.
- **Sync vrstva**: sdílený config ve shop metafieldu (C7 platí), 1 automatický + 1 kódový uzel
  na kódové pravidlo, deaktivace místo mazání (historie použití zůstává), proměnné uzlů,
  produktové metafieldy + `ProductTargetIndex`, webhooky produktů/kolekcí → obnova cílení na
  pozadí, SyncRun s vazbou na verzi configu a plán, zámek s deadlinem, verze configu všude.
- **Nativní slevy**: detekce, přesun (automatické vytvoř → ověř → smaž, kódové smaž → vytvoř),
  undo, živé ověření před obnovou, sweep zaseklých přesunů (Přehled + periodicky po 5 min).
- **Admin**: Přehled v1, Slevy a kódy + editor (hodnoty per měna, rozsah minima, Pro amber),
  Vyzkoušet košík (= skutečný výstup funkce + varování), onboarding 1–3, i18n cs/en, dev harness.
- **Živé důkazy (dev store)**: pokladna přes Bogus = `planCart` na obou tématech (MVP 1 profil;
  tvary výstupu: zastropovaná částka → ZDARMA; Pro stack 15 % s dev Pro, **ve Free se neuplatní**
  → BILL-1 ověřen v pokladně); přesun + undo naživo 14/14; úklid ověřen. Fakta F0: minimum =
  vybrané produkty, kombinace jen když souhlasí obě, limit použití na slevu, 10 000 B = UTF-8.
  → `docs/won-discounts/evidence/mvp1/` (final-gate-phaseA/B, gate-*, t6-*, c7-*, f0-*).
- **Audit MVP 1** (0 P0 / 2 P1 / 10 P2 / 8 P3 + dílčí audity nativních slev (6× P1) a driftu
  Rust↔TS (žádný drift, 2× P1 procesní)) → **všechny nálezy opraveny** ve vlnách F0–F3 + sweep,
  každá s re-review.

**Brána (HEAD `733727a` + docs)**: core 582 + testing 21 ✓ · guard 301 ✓ · `test:unit -w
won-discounts` node 554 + cargo 43 + vitest 213 ✓ · typecheck ✓ · lint ✓ · `build:all` ✓ ·
validate 0 nálezů ✓ · `_template` 18 + typecheck ✓ · Toasts typecheck ✓. Živé E2E ✓ Horizon ✓ Dawn
(Free i Pro profil).

**Vědomé kompromisy**
- Funkce ve dvou jazycích (TS reference + Rust produkce) — hlídá shoda, ne jeden kód; **CI shodu
  netestuje** (`.github` mimo rozsah) → doporučení pro Ondřeje: CI job s Rustem.
- Obnova cílení na kolekce: webhooky + debounce 60 s + auto-refresh po 24 h; nové produkty v
  kolekci dostanou slevu se zpožděním sekund až minut (zákazník dostane méně, nikdy víc).
- Pevná sleva na dopravu jde jen na první doručovací skupinu (Shopify neříká, zda se bere jednou).
- Zámky, fronty a sweep jsou per proces (předpoklad jedné instance na Fly — MVP 7).
- `read_markets` je volitelný scope (API-1) — Pro cílení na trh si o něj řekne až při zapnutí.

**Neověřeno**
- Vložení adminu do Shopify adminu (App Bridge navigace, resource picker, save bar, `?locale=`) —
  ověří Ondřej.
- Pokladna v měně EUR/USD živě (jen CZK); rozdělené doručení; zaokrouhlení půlek na straně
  Shopify (engine remízám předchází přesnou částkou).
- Chování na Postgresu (claim index je jen v SQLite migraci — port ručně, MVP 7).

### MVP 0 — Scaffold + verdikty rizik ✅ (badge zůstává `Scaffold`)

**Hotové a ověřené**
- Spec + plán (`docs/plans/2026-09-28-won-discounts-mvp0.md`), scaffold z `_template`, appka
  propojená (`config:link`, Ondřej) a nainstalovaná na dev storu (auto-grant scopes).
- `@won/core/discounts`: config v0 (typy všech modulů, sanitizer se stropy, migrace, tolerant
  reader, novější schéma jen pro čtení), money per měna, payload funkce (jen podmnožina, vždy
  klíče kampaně, rozpočet 9 000 B pro nejhorší případ).
- Prisma `ShopConfig` + `ConfigVersion` (historie 90 dní), Přehled v0 (`OverviewScreen`, sdílený
  s dev harnessem), mazání dat v `shop/redact` s retry.
- JS discount funkce `won-discounts-engine` (API 2026-04) s prototypovými módy, 27 fixtures.
- Theme app extension: app embed (`loading` → `ready` z JS), 715 B gz JS, theme check 0.
- App proxy health, dev harness jen v development/test (build-time i runtime).
- **Živé E2E embedu ✓ Horizon ✓ Dawn** (4/4, bez `--bail`, overlay s registračním UUID) →
  `docs/won-discounts/evidence/mvp0/e2e-embed-matrix.md` + screenshoty 390/1440.
- Verdikty C1–C5 s důkazy (tabulka výš), spec §2/§3/§6/§11 upravený.
- Nezávislý audit (0 P0 / 2 P1 / 8 P2 / 11 P3) → **všechny nálezy opraveny** ve 4 vlnách
  s re-review (výjimky níž).

**Brána (HEAD `3b20006`)**: `test:packages` core 392 + testing 21 ✓ · `test:unit -w won-discounts`
121 + engine vitest 27 ✓ · typecheck ✓ · lint ✓ · build (vč. funkce) ✓ · `validate:shopify`
0 nálezů (Toasts 6 + Discounts 4 soubory) ✓ · `guard:test:core` 301 ✓ · `_template` unit 18 +
typecheck ✓.

**Vědomé kompromisy / odklady**
- Retenční úklid historie pro spící shopy (`pruneExpiredConfigHistory`) existuje, napojí se na
  scheduler v MVP 5 (ten vzniká kvůli konci výprodeje). Do té doby úklid jen při uložení.
- CI (`.github/workflows/ci.yml`) nespouští `test:unit` appek — mimo povolený rozsah; doporučení
  pro Ondřeje: přidat `npm run test:unit -w won-discounts` do CI.
- Testovací route `_template` pro `shop/redact` počítá se SQLite; appka na Postgresu ji přepíše.
- Transport configu (audit P2-8): rozhodne prototyp C7 v MVP 1 (shop metafield vs. kopie v uzlech).

**Neověřeno**
- Vložení adminu do Shopify adminu (embedded UI) — vizuálně ověří Ondřej na konci.
- Chování na Postgresu (souběžné uložení testováno jen na SQLite + vynucené prokládání).

**Poučení** viz sekce výš (registrační UUID embedu, glob `test:unit`, 1 produktová sleva na
řádek, klíče kampaně povinné, Cloudflare 429 na storefrontu → tempo ≥ 1,5 s).

## Parkované otázky a dluh

Drobnosti z task review MVP 0, které po opravách auditu zůstaly (žádná neblokuje):
- `packages/core/src/discounts/config.ts` je velký soubor (sanitizery všech modulů) → rozdělit
  po modulech při T1 MVP 1 (engine), bez změny chování.
- `DISCOUNT_VALUE_KINDS` / `DISCOUNT_TARGET_KINDS` se ve validaci neověřují přes pole (drift) → T1.
- Funkce: `any` casty místo generovaných enumů (nahradí engine v T2 MVP 1).
- `build` appky potřebuje Shopify CLI (devDependency) a stažení javy/function-runneru →
  Dockerfile v MVP 7 musí stavět s devDependencies.
- Contract testy extensionu jsou textové (regex nad zdrojem); chování ověřuje živé E2E.
- `eslint-disable no-undef` u `process.env` (chybí node globals v eslint env appky).
- E2E: `.not.toHaveCount(0)` → `.toHaveCount(1)` (styl).
- Storefront má Cloudflare challenge (429) při rychlých zápisech do košíku → E2E a skripty
  drží tempo ≥ 1,5 s.
