# 11: Jedno uložení: editor slevy, Marže, Překlady, Nastavení

**What to build:** Inline „Uložit“ (PageSave) zmizí z editoru slevy, Ochrany marže, Překladů a Nastavení. Ukládá se jen přes Save Bar. Nastavení má dnes „Uložit“ uprostřed stránky. Pravidlo „jedno uložení na stránku“ je zapsané v ADMIN-UX-PRINCIPLES (§2 sjednocený s doktrínou). Pokud PageSave už nikdo nepoužívá, smaže se. Audit F3, X3.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Na rule-editor, margin, translations, settings žádný viditelný submit mimo Save Bar a jednorázové akce
- [ ] E2E „the page's Save is shown only under a view…“ upravené na nové pravidlo (změna popsaná v commitu)
- [ ] ADMIN-UX-PRINCIPLES a doktrína si neodporují
- [ ] Ruční postup ověření v shopify app dev v ticketu
