# 22: Převod obrazovek, dávka A: Přehled, Slevy a kódy, editor slevy

**What to build:** Přehled, Slevy a kódy a editor slevy se skládají z komponent shellu. Žádné hex barvy a minimum inline stylů (jen rozvržení). Surové HTML prvky jen jako výjimky ze shellu. Vzhled se nemění. Audit D1, D2, migrate.

**Blocked by:** 12, 13, 15, 21

**Status:** done

- [x] Lint v těchto obrazovkách a jejich částech bez varování o barvách
- [x] Screenshoty před a po stejné (vizuální porovnání, rozdíly vysvětlené)
- [x] Všechny testy zelené, klávesnice (keyboard.mjs) bez regresí

## Důkaz

- Lint: v Přehledu, Slevách a kódech, editoru slevy a jejich částech (`OverviewScreen`, `DiscountsScreen`, `RuleEditorScreen`,
  `rule-editor/*`, `RecipeGrid`, `RuleRow`, `MoveDialog`, `NativeDiscounts`) žádné varování o barvách. Hex nahrazen tokeny
  (`WON_CONTROL_EDGE`, `WON_SELECT_TINT`, `WON_SURFACE`, `WON_TAB_ON`, `WON_SELECT_FOCUS`).
- `RuleTable` přesunutý do `shell/RuleTable.tsx` jako zdokumentovaná výjimka (Polaris `s-table` nemá řádek záložek,
  hledání s filtrem ani řaditelnou hlavičku); jeho surové prvky jsou tím jen ve shellu. Mapa v README upravená.
- `rule-editor/GeneratedCodes.tsx`: surová tlačítka a pole převedena na Polaris (`s-button variant="tertiary"`,
  `s-button icon="x"`, `s-search-field`, `s-link` pro CSV). Vědomá vizuální změna jen u karty generovaných kódů
  (`generated-codes-{390,1440}.png`): odkazy jsou tlačítka Polaris místo podtrženého textu. Karta není v 22 stavech harnessu.
- Rozvržení: inline styly v obrazovkách dávky A zůstávají jen pro rozvržení a typografii; barvy už z tokenů.
- Pixelové porovnání 44 stavů s ticketem 21 (`compare-vs-21.txt`): 3 snímky, 0,002–0,009 % pixelů, šum vykreslování
  (stejné soubory se liší i bez změny kódu).
- Klávesnice: `keyboard.mjs` (`keyboard.txt`): na Přehledu, Slevách, Množstevních slevách a Výprodeji nic klikacího mimo tab,
  všech 56 zastávek s viditelným fokusem.
- Brána: node 2057/2057, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.
