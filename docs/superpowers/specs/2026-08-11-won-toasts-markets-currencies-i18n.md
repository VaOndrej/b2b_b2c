# Won Toasts — Markets: Currencies editing + i18n coverage

Datum: 2026-08-11
Navazuje na: rename Languages → Markets (hotovo, commit „rename Languages page to Markets").

## Kontext

Languages je nově **Markets** (`app/routes/app.markets.tsx`, `/app/markets`) —
jedno místo pro vše market-specific. Teď obsahuje jen Languages (překlady). Tenhle
spec dotahuje dvě zbývající části: **Currencies** (přesun editace per-měna prahů)
a **i18n coverage** (hardcoded shopper stringy → přeložitelné).

## Část A — Currencies sekce (přesun z Toasts)

**Dnes:** per-měna free-shipping prahy se editují v collapsed disclosure
„Selling in more currencies?" uvnitř free-shipping milestonu na Toasts
(`app.toasts.tsx`, pole `ms_ship_cur_<i>` / `ms_ship_amt_<i>`). Data žijí v
`config.milestones[].thresholds: Record<string, number>` (ISO → minor units);
`thresholdCents` je základ. To je market-specific věc pohřbená v jednom typu toastu.

**Cíl:** sekce **Currencies** na Markets, tabulka měna → práh, pro relevantní
milestony (free shipping; případně gift). Toasts disclosure nahradit odkazem
„Set per-currency thresholds in Markets".

**Kroky:**
1. Markets loader: načíst `config.milestones` (nebo aspoň free-shipping milestone).
2. Markets UI: sekce „Currencies" — base práh (read-only info, edituje se u toastu
   jako částka) + řádky měna/práh (stejný tvar jako dnešní disclosure).
3. Markets action: parsovat `ms_ship_cur_<i>`/`ms_ship_amt_<i>` → sanitizovat →
   zapsat do příslušného milestone `thresholds` přes `updateToastConfig`
   (merge, neklobrovat ostatní milestony/messages).
4. Toasts: odstranit disclosure, nahradit `<s-link href="/app/markets">`.
5. Testy: parsing per-měna prahů (pure sanitizer, pokud ještě není), a že save
   nezničí ostatní milestony.

**Pozor:** `thresholds` je per-milestone. Rozhodnout, jestli Currencies edituje
jen free-shipping, nebo všechny milestony s prahy. Doporučení: začít
free-shipping (to je dnešní rozsah disclosure), gift doplnit pokud dává smysl.

## Část B — i18n coverage (hardcoded shopper stringy)

**Audit (hotový):** tyto shopper-viditelné stringy obcházejí `messages`/překlady:
- `DEFAULT_TITLES` „Added to cart"/„Removed"/„Updated" —
  `packages/core/src/toasts/presentation.ts:30` + storefront kopie
  `storefront-src/won-toasts.js:303`.
- Grouping „+N more" — `won-toasts.js:316` a `:1657`.
- „Undo" — `won-toasts.js:1408`. „Dismiss" — `won-toasts.js:1531`.

**Cíl:** každý shopper-viditelný string přeložitelný přes `messages`/locale, ať
Markets → Languages fakt pokrývá „vše, co toast říká".

**Kroky:**
1. Katalog UI stringů (titles per semantic type + „more"/„Undo"/„Dismiss") do
   `messages` (nebo nový `ui`-namespace v locales), s anglickým defaultem.
2. `resolveToastPresentation` a config endpoint (`won-toasts.config.tsx`) protáhnout
   locale → resolved titles/labels poslat na storefront.
3. Storefront JS: brát tyto stringy z configu, ne z hardcoded konstant.
4. Markets → Languages UI: doplnit tyto klíče do překladové matice.
5. Test/audit: prokázat, že žádný shopper-viditelný string není hardcoded mimo
   `messages` (grep-gate nebo unit).

## Mimo rozsah
Admin copy (merchant-facing, zůstává EN). Ceny/Function. Nové typy toastů.
