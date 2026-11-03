# 12: Přehled: „Vyžaduje pozornost“ seskupené podle příčiny

**What to build:** Karta Vyžaduje pozornost na Přehledu ukazuje řádky seskupené podle příčiny („2 slevy nemají částku pro Slovensko · Doplnit hodnotu“) místo velkých karet se stejnou větou. Seskupení počítá čistá funkce v modelu s unit testem. Dlaždice Slevy a kódy nese jen štítek stavu a červený rámeček (vizuál zůstává), počet „N věcí k vyřešení“ se neopakuje. Audit F2, zásada E1.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Unit test seskupení (stejná příčina → jeden řádek s počtem, různé příčiny → různé řádky)
- [ ] overview?state=live: každý problém je na stránce zmíněný jednou (Playwright počítá výskyty)
- [ ] Výška Přehledu na 390 px pod 2 600 px (baseline 3 117)
- [ ] Doplnit hodnotu dál vede na správnou slevu
- [ ] Screenshot 390 + 1440, Free i Pro
