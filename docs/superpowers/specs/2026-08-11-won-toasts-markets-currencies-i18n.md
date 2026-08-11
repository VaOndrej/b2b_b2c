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

## Část B — i18n coverage (REVIDOVÁNO po hlubším auditu)

**Zjištění:** cart titulky **UŽ přeložitelné jsou** — storefront `presentation()`
volá `messageFor(grp.type, TITLES[...])` (`won-toasts.js:320`); `TITLES`/
`DEFAULT_TITLES` jsou jen anglický **fallback**, když merchant nemá message.
Merchant nastaví „Přidáno do košíku" na Markets → Languages a jede. Takže
původní audit byl přísnější, než realita.

**Reálný zbytek = 3 generická chrome slova**, natvrdo anglicky, mimo `messages`:
„+N **more**" (`won-toasts.js` grouping), „**Undo**", „**Dismiss**" (aria).

**Proč nejsou v JS bundle (pokus + revert):** vestavěný 11-jazyčný slovník do
storefront JS přidal ~270 B gzip a **porušil perf budget** (11534 > 11264 B).
Storefront musí zůstat lean → slovník **nepatří do JS bundle**.

**Správná cesta (nedodělaná):** poslat chrome překlady ze **serveru** —
`won-toasts.config.tsx` přidá do payloadu `ui` mapu (locale → {more,undo,dismiss}),
storefront `ui(key)` čte z `cfg` (ne z konstant). JSON payload není v gz-budgetu
JS. Merchant nic nepřekládá (product words, vestavěné). Volitelně později
zpřístupnit v Markets → Languages pro override.

**Kroky:** (1) `ui` mapa do config endpointu; (2) storefront `ui(key)` z `cfg.ui`
+ EN fallback; (3) nahradit 3 hardcoded použití; (4) ověřit budget zelený.

## Mimo rozsah
Admin copy (merchant-facing, zůstává EN). Ceny/Function. Nové typy toastů.
