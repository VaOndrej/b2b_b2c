# 07: Editor slevy: číslování kroků jen u nové slevy

**What to build:** U nové slevy jsou očíslované všechny sekce a čísla sedí (dnes „KROK x / 4“ u pěti sekcí). U úpravy existující slevy se kroky nečíslují, sekce mají jen názvy. Ověřit ve skutečném adminu, jestli datum ukazuje „YYYY-MM-DD“. Pokud ano a jde to opravit na straně appky, opravit. Pokud ne, zapsat do ticketu. Audit F10.

**Blocked by:** None (can start immediately)

**Status:** done, čeká na ruční ověření formátu data

- [x] rule-editor?rule=new… čísluje všechny sekce s jednotným jmenovatelem
- [x] rule-editor?rule=<existující> nemá žádné „KROK“
- [x] Zjištění k formátu data zapsané v ticketu
- [x] Screenshot 390 + 1440 obou stavů

## Důkaz

- `rule-editor/steps.ts` `editorStep(n, isNew)`: číslo kroku jen u nové slevy, jmenovatel 5 (Sleva, Podmínky, Jak se uplatní,
  Kdy platí, Kombinace a trhy). `EditorView.isNew` z `mode === "new"`. Existující sleva: žádné „Krok“.
- Test `tests/ui/screen-consistency.test.ts` „a new discount numbers all five sections…“ (nahradil test „four sections are numbered
  steps“, záměrná změna): nová sleva Free i Pro = Krok 1/5 až 5/5, existující (Free, Pro, výchozí) = žádné `data-won-section-step`.
- Brána: node 2044/2044, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 50/50.
- Screenshoty: `docs/won-discounts/evidence/frontend-07/rule-new-{390,1440}.png`, `rule-edit-{390,1440}.png`, `rule-edit-pro-{390,1440}.png`.

## Formát data (zjištění)

- „YYYY-MM-DD“ v polích Od / Do je vlastní placeholder `s-date-field` od Polaris. Appka žádný placeholder nenastavuje a hodnota
  pole je podle Polaris vždy ve formátu `YYYY-MM-DD` (dokumentace typů `@shopify/polaris-types`, DateField `value`).
- V harnessu má stránka `lang="en"` a chybí jazyk adminu, takže Polaris ukazuje anglický vzor. Ve skutečném adminu to ověřit nešlo
  (není `shopify app dev` ani přístup do adminu v této session). Oprava na straně appky by byla jen vlastní `placeholder`
  („RRRR-MM-DD“), hodnota by zůstala ISO. Nedělám ji naslepo.
- **Ruční ověření (Ondřej):**
  ```bash
  cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts && npm run dev
  ```
  V adminu s češtinou: Slevy → Slevy a kódy → Nová sleva → % na vše → sekce „Kdy platí“. Když pole Od / Do ukazují
  „YYYY-MM-DD“ i v češtině, napiš, a doplním `placeholder` s českým vzorem.
