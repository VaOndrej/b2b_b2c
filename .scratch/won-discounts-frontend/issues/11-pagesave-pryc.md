# 11: Jedno uložení: editor slevy, Marže, Překlady, Nastavení

**What to build:** Inline „Uložit“ (PageSave) zmizí z editoru slevy, Ochrany marže, Překladů a Nastavení. Ukládá se jen přes Save Bar. Nastavení má dnes „Uložit“ uprostřed stránky. Pravidlo „jedno uložení na stránku“ je zapsané v ADMIN-UX-PRINCIPLES (§2 sjednocený s doktrínou). Pokud PageSave už nikdo nepoužívá, smaže se. Audit F3, X3.

**Blocked by:** 09

**Status:** done, čeká na ruční ověření Save Baru

- [x] Na rule-editor, margin, translations, settings žádný viditelný submit mimo Save Bar a jednorázové akce
- [x] E2E „the page's Save is shown only under a view…“ upravené na nové pravidlo (změna popsaná v commitu)
- [x] ADMIN-UX-PRINCIPLES a doktrína si neodporují
- [x] Ruční postup ověření v shopify app dev v ticketu

## Důkaz

- Inline „Uložit“ pryč z editoru slevy (`RuleEditorScreen.tsx`), Ochrany marže (`MarginScreen.tsx`), Překladů
  (`TranslationsScreen.tsx`) a Nastavení (`SettingsScreen.tsx`, bylo uprostřed stránky). Všechny už měly jeden formulář
  s `data-save-bar`, ukládá jen Save Bar. `shell/PageSave.tsx` smazaný (nikdo ho nepoužívá).
- Jednorázové akce zůstávají: Smazat slevu (s potvrzením), Přesunout, opravy nesouladu Sčítá se s, Přidat / Odebrat jazyk,
  Stáhnout CSV, Uložit změny z importu, akce tarifu.
- E2E „the page's Save is shown only under a view…“ přepsaný na „no view of a page shows a Save of its own: the save bar
  is the one save“ (`admin.views.spec.ts`): Množstevní slevy a Marže ve všech pohledech, Milníky, Nastavení, Překlady,
  editor (existující i nová sleva) nemají viditelné „Uložit“. Vzhled si „Uložit vzhled“ nechává.
- Unit: `screen-consistency.test.ts` „no page draws a Save of its own“ (8 stavů: formulář se Save Barem, žádný submit),
  `harness-screens.test.ts` Nastavení a Marže bez submitu.
- Jedno uložení zpevněné (`shell/one-save.tsx`): základ „co se změnilo“ se čte hned, když jsou Polaris prvky definované;
  když změna předběhne čtení, uloží se všechno (žádná část se nepřeskočí omylem). E2E 3× za sebou zelené.
- **Dokumentace:** `apps/won-discounts/docs/ADMIN-UX-PRINCIPLES.md` §2 „Jedno uložení na stránku: Save Bar“ (část s vlastní
  akcí, výjimky jednorázových akcí, co zatím zůstává mimo). Doktrína §19e: „one form and one Save (the App Bridge save bar,
  no Save button of its own)“. Obecné pravidlo i do šablony `apps/_template/docs/ADMIN-UX-PRINCIPLES.md` §2.
- Brána: node 2050/2050, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 58/58.
- Screenshoty `docs/won-discounts/evidence/frontend-11/`: `rule-new`, `rule-edit`, `margin-pro`, `translations`, `settings` (390 + 1440).

## Ruční ověření Save Baru (Ondřej)

```bash
cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts && npm run dev
```

1. Slevy a kódy → otevři slevu → změň název. Save Bar se objeví, dole na stránce žádné „Uložit“. Ulož, obnov: název drží.
2. Ochrana marže → změň hranici → Save Bar → Zahodit vrátí hodnotu.
3. Překlady → změň text → ulož přes Save Bar, obnov.
4. Nastavení → přepni Kombinování slev → ulož přes Save Bar. Uprostřed stránky žádné „Uložit“.
5. Na kterékoli z nich změň pole a klikni do menu jinam: Shopify se zeptá na neuložené změny.
