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

## Než začneš stavět admin

Šablona nemá vlastní komponenty adminu; kostru (`WonSection`, dlaždice, štítky)
převezmi z poslední Won appky a drž se doktríny `docs/won-app-design-doctrine.md`
§18 a §19. Čtyři pravidla ze třetího průchodu Won Discounts (§19), která se
vyplatí postavit hned:

- **Stav říká jedna funkce.** „Aktivní“ znamená uložené, zapsané v Shopify
  a spouštěné tarifem. Stejnou funkci volá úvodní dlaždice, stránka modulu
  i sekce uvnitř. Neuložený přepínač štítek nemění.
- **Pro jen jednou za sekci.** Jantar a štítek nese hlavička sekce, vnořené bloky
  jsou bílé s šedou linkou. Hlídá to kostra (kontext sekce), ne jednotlivé obrazovky.
- **Umístění na webu má štítek a tlačítko.** „V tématu“ (zelený), „Chybí v tématu“
  (červený, s tlačítkem na přidání v hlavičce), „Neověřeno“ (šedý, se „Zkontrolovat
  znovu“). Co se nepodařilo přečíst, není „chybí“.
- **Úvodní stránka je rozcestník z dlaždic.** Celá dlaždice je odkaz, detailní
  řádky patří na stránku modulu. Dva sloupce na telefonu, tři na desktopu.
