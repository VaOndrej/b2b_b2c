# Audit MVP 4 — Odměny + košík (2026-10-01)

Rozsah: `git log b514f18^..HEAD` (plán R1–R9, core, Rust, sync, app proxy, storefront, admin, docs, E2E). Způsob:
inline podle `.claude/agents/won-auditor.md` (findings-first, P0–P3, důkaz soubor:řádek), plus samostatná kontrola
shody Rust ↔ TS a rozpočtu instrukcí. Živé E2E (fáze A) běželo **před** auditem a samo našlo tři chyby košíku —
jsou uvedené níž, protože bez živého běhu by prošly všemi testy na falešné stránce.

## Findings

Žádný P0 ani P1.

### Nalezené živým E2E (opravené před auditem)

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| E1 | P2 | Panel po přidání zboží četl `/cart.js` z HTTP cache (starý košík) → dárek se nepřidal | diagnostika E2E „zbývá 10 Kč“ při 5 ks | `cache: "no-store"` (`ca56ea4`), test s modelem cache |
| E2 | P2 | `shopify:cart:lines-update` se vysílá na **začátku** změny (Storefront Events) → panel četl košík před dokončením | doc Storefront Events „Waiting for the result“ | čekání na `event.promise` (`7e194cf`), test |
| E3 | P2 | Dotykové cíle panelu < 44 px (390 px); v Dawnu `rem` = 10 px | `assertResponsiveSane`, evidence `*-controls-*.json` (min-height 27,5 px) | `44px` (`ca56ea4`) |

### Audit

| # | P | Dopad | Důkaz | Oprava |
|---|---|---|---|---|
| F1 | P2 | Jedna akce zákazníka = dvě události (Dawn pubsub + standardní) → dvě souběžné reakce → dárek 2 ks, druhý placený | `won-discounts-cart.js` `onChange` (před `242142b`) | jedna fronta reakcí, každá čte čerstvý košík (`242142b`), test „two cart events“ |
| F2 | P2 | Okno `selfUntil` 4 s po našem zápisu spolklo i skutečnou změnu zákazníka (dárek pod prahem zůstal) | tamtéž, ř. 36/159 | zrušeno, rozhoduje jen `detail.won` (ověřeno živě) (`242142b`), test „not swallowed“ |
| P1 | P2 | Cache app proxy bez stropu; veřejný endpoint s náhodnými variant id → neomezený růst paměti | `cart-plan.server.ts` `variantCache` | strop 5 000 záznamů, prošlé a nejstarší pryč (`8b85ad2`), test |
| P2 | P2 | Každý požadavek s novými id = Admin API dotaz až na 100 variant → spam vyčerpá API rozpočet shopu (a tím sync) | `cart-plan.server.ts` `readVariants` | nejvýš 30 požadavků se čtením za minutu na shop, nad limit 429 bez tipu (`8b85ad2`), test |
| L1 | P3 | `all_products` v embedu obslouží 20 handle na stránku; Pro žebřík 10 × (3 + 1) = 40 → nad 20 bez titulku a dostupnosti | `won_discounts_embed.liquid` ř. 47–75, `CONFIG_LIMITS.giftTiers` 10 | strop **5 prahů** (5 × 4 = 20), test vazby (`bdc80de`); docs „up to 5“ |
| A1 | P3 | Uložený Pro práh ve Free červeně (`tone="attention"`); doktrína §16b: tarif = jen amber | `RewardsScreen.tsx` ř. 207 | `ProFrame locked` (`a9fe1dc`), test barvy |
| F3 | P3 | Odmítnutá změna `updateCart` (`userErrors`) se zákazníkovi neříká | `won-discounts-cart.js` `write` | ponecháno vědomě: panel košík přečte znovu a dárek nabídne znovu; zapsáno v README extensionu (`242142b`) |
| R2 | P3 | README funkce uvádělo Wasm 244 781 B; build z commitnutého `src` = 245 237 B | `README.md` „Wasm size“ | opraveno (`a6b86a1`) |
| D1 | P3 | Kontrakt R8 sliboval serverové vykreslení panelu (bez CLS); blok jen rezervuje místo | plán ř. 106 | kontrakt upřesněn podle měření: CLS 0 / 0,033 ≤ 0,1, E2E SF-1 hlídá (`a6b86a1`) |

## Shoda Rust ↔ TS a rozpočet instrukcí

- **Fixtures** 115 (10 nových pro odměny), **náhodná parita** „rewards, seed 20261010 × 2400“ 0 rozdílů (brána).
- **Replay** zalogovaných běhů dev storu: viz „Replay“ níž (build MVP 3 vs. finální MVP 4).
- **Adversariální rozpočet odměn** (stop-pravidlo předem: jeden průchod, ≥ 100 % → strop odměn v payloadu): rodiny
  MVP 3 cap 550 (3 320 vstupů na limitu velikosti) × varianty odměn, 0 DIFF vůči TS:
  - nejdražší payload, který se vejde do 9 000 B (místo z `marketCountries`): 9 960 běhů, max 89,15 %;
  - malý payload (1 práh, měna košíku): 6 640 běhů, **max 99,32 %**, 0 ≥ 99,5 %;
  - stejné rodiny bez odměn na buildu MVP 4: max 99,21 % (build MVP 3: 98,67 %).
  Strop odměn není potřeba. **R1 (P3, otevřené jako riziko):** engine MVP 4 přidal ~0,5 bodu i bez odměn, rezerva
  k 100 % je pod 1 bod → MVP 5 přeměří tyto rodiny jako první krok (zapsáno v README funkce).
- **Realistické košíky:** max 87,37 % (≤ 90 %), běžné fixtures ≤ 70 %.
- Wasm 245 237 B < 256 000 B; dotaz funkce beze změny délky odměn (atribut `gift` už existoval).

## Replay

`tests/replay-logs.mjs`, 2 691 zalogovaných běhů dev storu, build MVP 3 (`final-3.wasm`) vs. finální MVP 4 (245 237 B):
MVP 4 shodný s logem 2 497, MVP 3 2 425. Buildy se liší v **72 bězích — všechny z dnešního E2E odměn**, kde MVP 4 dává
přesně zalogovaný výstup a MVP 3 odměny nezná. Od logu se oba liší ve 194 bězích (150 z 28. 9., 44 z ranních mezibuildů
MVP 3) — tatáž množina jako při replay v úkolu 2. Selhání runneru 0. **Žádný nový rozdíl.**

## Open questions / assumptions

- `Shopify.actions.updateCart` se ověřuje na doméně storu s náhledem nepublikovaného tématu; samotný `shopify theme dev`
  Storefront API neobslouží. Produkční storefront je same-origin jako náhled → očekává se stejné chování.
- Dawn na dev storu má košík typu „notification“ (bez draweru) — F-R1 drawer je ověřený na Horizonu.
- Zobrazení dopravy v pokladně jako „$0.00“ (ne „0 Kč“) je formát pokladny dev storu; částka 0 sedí s planCart.

## Overall risk summary

Logika odměn (core ↔ Rust) je pevná: parita, replay a rozpočet bez nálezu. Rizika byla v integraci se storefrontem
(čtení košíku, časování událostí, souběh reakcí) — všechna nalezená živým E2E nebo auditem a opravená s testem, který
bez opravy padá. App proxy je zabezpečená proti zahlcení paměti i API rozpočtu.

## Testing gaps

- Vyprodaný dárek a záložní dárek nejsou ověřené naživo (katalog `won-e2e-*` nemá sledovaný sklad; změna skladu by
  byla zápis do katalogu). Pokryto testy na falešné stránce (`storefront-cart.contract.test.ts`) a Liquid
  (`available` z `all_products`).
- Pro žebřík s výběrem ze 3 ověřuje fáze B (`rewards-pro`).
