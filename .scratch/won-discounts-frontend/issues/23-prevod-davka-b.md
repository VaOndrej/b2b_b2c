# 23: Převod obrazovek, dávka B: Množstevní slevy, Milníky, Výprodej, Kampaně

**What to build:** Stejně jako 22 pro Množstevní slevy, Milníky, Výprodej a Kampaně. Velké obrazovky (Výprodej, Kampaně, Milníky) se při tom rozdělí do vlastních složek se sekcemi podle vzoru editoru slevy. Vzhled se nemění. Audit D1, D2, D3.

**Blocked by:** 17, 19, 21

**Status:** done, kritérium ≤ ~400 řádků splněné částečně, přijato Ondřejem 2026-11-03

- [x] Lint bez varování o barvách v těchto obrazovkách
- [ ] Žádný soubor obrazovky nad ~400 řádků
- [x] Screenshoty před a po stejné, testy zelené

## Důkaz

- **Barvy:** Množstevní slevy (`tiers/*`), Milníky (`rewards/*`, Milníky), Výprodej a Kampaně bez varování o barvách.
  Literály nahradil skript `codemod.py` (v evidenci) pojmenovanými tokeny se stejnou hodnotou (`shell/tokens.ts`, +4 nové:
  `WON_LIVE_TEXT_DEEP`, `WON_MUTED_ALT`, `WON_WARNING_TEXT`, `WON_INK_SHADOW`).
- **Surové prvky** přesunuté do `shell/Controls.tsx` jako zdokumentované výjimky (Polaris nemá ekvivalent): posuvník náhledu
  Milníků (`RangeInput`), rozbalovací řádek stupně (`RowButton`), volby v kartě Výprodeje (`CardRadio`, `CardCheckbox`),
  tlačítka − / + ve vzorku obchodu (`SampleButton`). V obrazovkách dávky B už žádné `<button>/<input>` kromě skrytých polí.
- **Složky:** `screens/outlet/` (`OutletScreen.tsx` 625 ř. + `RunCard.tsx` 537 ř.), `screens/campaigns/` (583 + 234),
  `screens/milestones/` (679 + 141). Importy v routách, harnessu, testech a v mapě README přesměrované. Rozdělil skript
  `split.py` (v evidenci), obsah funkcí beze změny.
- **Nesplněno:** hlavní soubory obrazovek mají 583–679 řádků, ne ≤ ~400. Jejich hlavní funkce (540–620 ř.) drží lokální stav
  formulářů a pohledů; rozdělit je na sekce by znamenalo přesouvat stav mezi komponentami. Nechávám na skutečnou úpravu
  dané obrazovky (audit D3: „Dělit až při skutečné úpravě dané obrazovky“). `TiersScreen.tsx` 422 ř. zůstal na místě.
- Pixelové porovnání 44 stavů s ticketem 22 (`compare-vs-22.txt`): 4 snímky, 0,001–0,003 % pixelů, šum vykreslování.
- Brána: node 2057/2057, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.

## Rozhodnutí Ondřeje 2026-11-03

- Částečné splnění přijato, nic dalšího se nedělá.
