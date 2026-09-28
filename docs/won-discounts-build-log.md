# Won Discounts — build log (autonomní běh)

Jediný stav běhu. Po kompakci kontextu nebo v nové session **začni tady** a pokračuj
od posledního nedokončeného kroku. Zadání: [`won-discounts/prompt-orchestrator.md`](won-discounts/prompt-orchestrator.md).
Spec: [`won-discounts-mvp-plan.md`](won-discounts-mvp-plan.md). Produktová rozhodnutí:
[`won-discounts/rozhodnuti.md`](won-discounts/rozhodnuti.md) (neměnit).

## Aktuální stav

- **Fáze:** MVP 0 — Fáze 0 (dokumenty + scaffold).
- **Hotovo ve Fázi 0:** spec `docs/won-discounts-mvp-plan.md` · build log · klon
  `apps/_template` → `apps/won-discounts` (přejmenováno v `package.json` + `shopify.app.toml`,
  `e2e.app.config.mjs` vyplněný, `npm install` zaregistroval workspace) · `.env` s heslem
  storefrontu · roadmapa: 5 karet (Tiers, GiftLadder/Rewards, ShipGoal, Outlet, MarginGuard)
  sloučeno do karty Won Discounts (`Scaffold`), přepsané Hranice portfolia a build fronta
  (kontrola tagů OK, screenshoty 390/1440 bez přetečení; záloha `scratchpad/product-roadmap.orig.html`).
- **Blokováno:** nic. Operace appky na dev storu jdou přes `shopify app execute` (bez tokenu
  ze `shpat.md`). Token zůstává potřeba jen pro sdílený seed (`seed:e2e-products`, nákupní ceny
  v MVP 2) — tam se zastavím, pokud nebude v `.env` + povolený.
- **Další krok po odblokování:** ověřit `shopify app info`, zapsat verdikt P2/P3, pak MVP 0
  plán (`docs/plans/2026-09-28-won-discounts-mvp0.md`) → prototypy C1–C5.
- **Poslední commit:** — (zatím nic necommitnuto v rámci běhu).

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

## Rozhodnutí běhu

- Nová doména v core: **`packages/core/src/discounts/`** (množné číslo). Stávající
  `packages/core/src/discount/` a `margin/` zůstávají beze změny kvůli `guard:test:core`
  b2b-companionu; nový engine z nich převezme logiku (import nebo kopie s testy), nezmění je.
- **Ondřej 2026-09-28: všechny slevy jdou přes Won Discounts** — i slevové upsely Won
  Companion (Pro) budou pravidla ve Won Discounts, Companion vlastní slevovou funkci nemá.
  Roadmap karta Companion upravena.
- E2E porty témat: Horizon `9885`, Dawn `9886` (Toasts má 9883/9884).
- Brainstorming skill vynechán: produkt je odsouhlasený (`rozhodnuti.md`), zadání chce plnou
  autonomii bez otázek.

## Verdikty rizik C1–C6

| # | Riziko | Verdikt | Důkaz |
|---|---|---|---|
| C1 | jeden mozek | — | — |
| C2 | limit 25 | — | — |
| C3 | 10 kB metafield | — | — |
| C4 | čas ve funkci | — | — |
| C5 | věrný náhled | — | — |
| C6 | kód při přesunu | rozhodnuto: záloha → smazání → vytvoření ve Won | `rozhodnuti.md` |

## Checkpointy MVP

_(zatím žádný)_

## Parkované otázky a dluh

- (P3) Práce s admin tokenem pro seed / úklid / testovací objednávky — čeká na rozhodnutí Ondřeje.
