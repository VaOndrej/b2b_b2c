# Won Discounts: umístění prvků na web, build log

Zadání: `WonCommerce/Apps/docs/won-discounts-umisteni-na-web-zadani.md` (mimo repo). Větev `won-discounts-umisteni`
ve worktree `WonCommerce/b2b_b2c-umisteni`, protože na `main` paralelně běžel krok 6 kombinování. Po dokončení se
sloučí do `main`. Samostatný log, aby se nepral s `docs/won-discounts-build-log.md`.

**CHECKPOINT U2 (14. 10. 2026).** Ondřej: ruční cesta = varianta (a), volitelná; druhá AI na `main` poběží dlouho,
živé ověření počká. **Balík B1 hotový v kódu, naživo neověřený:**

- Jádro: `tg` v konfiguraci pro web (`themeTagsPart`, `StorefrontConfigOptions.themeTags`): `ms` velikosti žebříku,
  `cp` kampaň, `cd` karty. Plní ho až balík E (čtení vzhledu); do té doby embed šablony netiskne.
- Embed: `<template data-won-tag>` jen podle `tg`, v editoru všechny ukázky (`*-sample`, důvod `sample.tag_unknown`
  a `sample.tag_card`), načte `won-discounts-tags.js` (1 083 B gzip, volitelný strop 1 280 B).
- `won-discounts-tags.js`: vlastní prvek `won-discounts`, plní prázdnou značku i po překreslení tématu.
- Košík: `won-discounts-cart.js` kreslí panel do značky (velikost z atributu); se značkou na stránce nehádá místa.
  `won-discounts-cards.js` se značkou karty nedělá nic.
- Popis značek jednou: `app/components/model/theme-tags.ts` → `docs/reference/theme-tags.generated.md` (chatbot),
  později průvodce v adminu a zadání pro AI.
- Testy: `tests/contracts/storefront-tags.contract.test.ts` (8, v Chromiu přes Playwright, bez sítě).

Brány: core 1 009, app 1 926, typecheck, lint 0 chyb, Theme Check bez nových nálezů.
Zbývá k B: **B2** karta mimo kolekci a vyhledávání (app proxy, výpočet jádrem `cardTier` na serveru: data produktu
přes Admin API, cache). Pak E (kdo plní `tg`), C, D.

**CHECKPOINT U1 (14. 10. 2026).** Ověření před stavbou zapsané v zadání (oddíl „Výsledek ověření“). Riziko:
App Store 5.1.1 („You or merchants should not make any code changes to the theme“) proti ruční cestě se značkou,
rozhoduje Ondřej. Balík A hotový v kódu, **naživo neověřený** (deploy rozšíření do dev obchodu čeká, až druhá AI
dokončí živé testy):

- Ukázka v editoru vzhledu (`request.design_mode`) se stejnými třídami a velikostí jako prvek, čárkovaný rámeček
  (outline, nebere místo) a důvod: `blocks/quantity_tiers.liquid` → `snippets/won-sample-tiers.liquid`;
  `blocks/card_tiers.liquid` (i mimo kartu: „přetáhněte ho do karty“); `blocks/cart_rewards.liquid` (ve slotu,
  skutečný panel ji skryje CSS `.won-cart:not(:empty) ~ [data-won-discounts-sample]`).
- Skutečný žebřík místo věty: `blocks/rewards_progress.liquid`, `blocks/announcement_milestones.liquid` →
  `snippets/won-sample-ladder.liquid` (velikost podle bloku).
- Důvod: `snippets/won-card-tier.liquid` vrací s `why` kód (`off, many, none, outlet, gift, margin, cap,
  currency`); texty `sample.*` v cs/sk/en, na stránce Překlady se nenabízejí (jen editor).
- Ukázka nese datové atributy, ne třídy: třídy patří vlastnímu vzhledu a průvodci AI.
- Odkaz na kartu: deep link neumí cílit dovnitř karty (`target=mainSection` dal blok vedle karet, kde nemá
  produkt). `cardBlockAddUrl` smazán, tlačítko otevře editor na šabloně kolekce a text řekne kroky.

Brány: `test:unit:node` 1 912 z 1 912, typecheck, lint 0 chyb (4 varování jako na `main`), Theme Check bez nových
nálezů (OrphanedSnippet je falešný, i na `main`). Screenshoty adminu: `evidence/umisteni-2026-10-14/karta-admin-*`.

Zbývá k A: živě na Horizonu a Dawnu, 390 a 1440 px, v editoru: tabulka (bez slevy, ve výprodeji, s marží),
karta (v kartě, mimo kartu), košík (embed vypnutý / zapnutý), Milníky ve třech velikostech, Oznámení: Milníky.
Další: B (čeká na rozhodnutí k 5.1.1).
