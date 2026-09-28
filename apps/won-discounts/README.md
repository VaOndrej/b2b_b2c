# App template

Základ pro novou Shopify appku v tomhle monorepu. Naklonuj ho a řiď se
kanonickým postupem: [`docs/nova-aplikace.md`](../../docs/nova-aplikace.md).

> **Povinný první krok (GATE):** žádná appka nezačne kódem ani klonem dřív, než
> projde **brainstormingem → rozpadem na MVP** dle
> [`docs/nova-aplikace.md` §0](../../docs/nova-aplikace.md) a má odsouhlasený
> `docs/<appka>-mvp-plan.md`. Vzor: [`docs/won-toasts-mvp-plan.md`](../../docs/won-toasts-mvp-plan.md).

## Než začneš stavět storefront extension

Tenhle template zatím **neobsahuje** theme app extension scaffold. Až nějaký
přidáš do `extensions/*`, drž se cross-theme pravidel z
[`docs/nova-aplikace.md` §8](../../docs/nova-aplikace.md) — jinak to spadne na
Dawn (nebo na variant morphu v Horizonu):

- Storefront JS reagující na variantu **rescanuj na `shopify:product:select`**
  (Horizon morphuje formulář in-place; `change`/MutationObserver to nechytí).
- Formulář hledej přes `input.form`, **ne** přes `ancestor::form` — Dawn váže
  input přes `form` atribut, ne vnořením.
- Asset servíruj **čitelně**, bez minifikace/buildu (je to malý soubor přímo
  z `assets/`).
- V E2E používej sdílené helpery `quantityForm` / `quantityStepper` z
  `@won/testing/playwright`, ne vlastní XPath předpokládající vnoření.
- Před shipnutím spusť matrix **bez `--bail`**, ať proběhne i Dawn leg.

## Won Discounts: build, dev a testy

Slevová funkce (`extensions/won-discounts-engine`) je v Rustu, detaily v jejím
[`README.md`](extensions/won-discounts-engine/README.md). Rust je nainstalovaný
přes rustup mimo výchozí PATH, skripty si `~/.cargo/bin` přidají samy.

- `npm run dev`: `shopify app dev` s cargo na PATH, funkce se při změně přestaví.
- `npm run build`: jen appka (react-router). CI (`build:apps`) Rust nepotřebuje.
- `npm run build:functions`: jen slevová funkce (cargo, pak trampoline CLI).
- `npm run build:all`: funkce, pak appka.
- `shopify app deploy` si funkci staví sám, takže taky potřebuje cargo na PATH:
  `PATH="$HOME/.cargo/bin:$PATH" npx shopify app deploy`.
- `npm run test:unit`: node testy a testy funkce (cargo test, pak vitest). Potřebuje
  Rust s cílem `wasm32-unknown-unknown`. CI testy funkce nespouští.
