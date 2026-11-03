# 05: Překlady: stažení a nahrání CSV prvky Polaris

**What to build:** Export a import textů v Překladech používá Polaris prvky s českými popisky. Zmizí prohlížečové „Choose File / No file chosen“ a nestylované tlačítko „Stáhnout CSV“. Chování (stažení, plán nahrání s potvrzením, nic se neuloží před potvrzením) zůstává. Audit F7.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] V sekci Export a import není žádný surový input ani button
- [x] E2E „the CSV downloads, an upload is planned first…“ projde beze změny asercí na chování
- [x] Na Free zůstává sekce zamčená jako dnes
- [x] Screenshot 390 + 1440

## Důkaz

- `TranslationsScreen.tsx`: surový `<input type=file>` v `<label>` nahradil `s-drop-zone` s popiskem „Nahrát CSV“ a českým
  obsahem „Přetáhněte sem soubor CSV, nebo ho vyberte kliknutím“ (`translations.csv.drop`, cs + en). Zóna nemá `name`,
  formulář stránky soubor neposílá. Událost `change` se poslouchá přes ref (React 18 nepředává události custom elementů).
  „Stáhnout CSV“ už bylo `s-button`, zůstává.
- E2E „the CSV downloads, an upload is planned first…“: aserce chování beze změny, jen lokátor míří na input uvnitř
  `s-drop-zone` (`[data-won-csv-file] input[type=file]`). Nový E2E „the CSV section is Polaris only“: v `#csv` není
  v light DOM žádný `button/input/select/textarea`, žádné „Choose File“, na Free i Pro.
- Free: sekce zamčená jako dřív, zóna zakázaná (`csv-section-free-390.png`).
- Neověřeno: text „Drop files to upload“ při přetahování souboru je vnitřní text Polaris a v harnessu (lang=en) je anglicky.
  V adminu ho Polaris lokalizuje podle jazyka adminu, ověřit při ručním průchodu.
- Brána: node 2043/2043, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 49/49 (48 + 1 nový).
- Screenshoty: `docs/won-discounts/evidence/frontend-05/` (celé stránky Free/Pro 390+1440, výřez sekce CSV Free/Pro 390+1440).
