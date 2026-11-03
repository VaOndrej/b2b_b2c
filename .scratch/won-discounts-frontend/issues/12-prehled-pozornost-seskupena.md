# 12: Přehled: „Vyžaduje pozornost“ seskupené podle příčiny

**What to build:** Karta Vyžaduje pozornost na Přehledu ukazuje řádky seskupené podle příčiny („2 slevy nemají částku pro Slovensko · Doplnit hodnotu“) místo velkých karet se stejnou větou. Seskupení počítá čistá funkce v modelu s unit testem. Dlaždice Slevy a kódy nese jen štítek stavu a červený rámeček (vizuál zůstává), počet „N věcí k vyřešení“ se neopakuje. Audit F2, zásada E1.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Unit test seskupení (stejná příčina → jeden řádek s počtem, různé příčiny → různé řádky)
- [x] overview?state=live: každý problém je na stránce zmíněný jednou (Playwright počítá výskyty)
- [x] Výška Přehledu na 390 px pod 2 600 px (baseline 3 117)
- [x] Doplnit hodnotu dál vede na správnou slevu
- [x] Screenshot 390 + 1440, Free i Pro

## Důkaz

- `model/attention.ts`: `groupAttention` (stejná příčina = jedna skupina, pořadí podle prvního výskytu) a `ruleWarningCause`
  (chybějící částka = druh + sada měn bez ohledu na pořadí, ostatní podle druhu). Unit `tests/ui/attention.test.ts`.
- `OverviewScreen.tsx`: karta Vyžaduje pozornost = řádky podle příčiny. Příčina jednou: věta, co s tím, tlačítko k poli.
  Příčina víckrát: „2 slevy nemají hodnotu pro Slovensko…“, co s tím, „Doplnit hodnotu: VIP10 · Černý pátek“ (každá sleva
  odkaz na své pole). Texty `overview.group.*` (cs, en, množná čísla). Velké karty `Finding` a řádek „A ještě N“ pryč.
- Dlaždice Slevy a kódy, Množstevní slevy, Milníky nenesou „N věcí k vyřešení“, když seznam drží všechny jejich věci
  (štítek a červený rámeček zůstávají). Když dlaždice počítá víc (neuložený zápis) nebo čeká na opravu zápisu, zůstává
  její vlastní věta.
- Mobil (≤ 520 px, `shell/ModuleTile.tsx`): dlaždice ukazují svou krátkou větu (`aboutShort`, mechanismus pro úzké dlaždice
  už existoval), menší vnitřní odsazení a mezery mezi skupinami. Desktop beze změny.
- Výška Přehledu na 390 px: live 2576 px (baseline 3117), Pro 2548, modules 2456 (`metrics.json`).
- Navíc oprava k 08: souhrn na dlaždici „1 neaktivní“ → „1 se neuplatní“ (`count.unsupported`, cs + en).
- E2E `admin.state-once.spec.ts`: na `overview?state=live` (Free i Pro) je každá sleva v seznamu jednou, „věci k vyřešení“ 0×,
  odkaz VIP10 vede na `#conditions`, výška na 390 px < 2600. Unit: `screen-consistency.test.ts` (řádky a seskupení),
  `markets-and-tiles.test.ts`, `harness-screens.test.ts` upravené na nový tvar.
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 60/60.
- Screenshoty `docs/won-discounts/evidence/frontend-12/`: `overview`, `overview-pro`, `overview-empty`, `overview-modules`,
  `overview-modules-pro` (390 + 1440).
