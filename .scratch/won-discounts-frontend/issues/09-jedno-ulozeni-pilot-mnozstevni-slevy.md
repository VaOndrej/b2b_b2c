# 09: Jedno uložení, pilot: Množstevní slevy

**What to build:** Na Množstevních slevách je jedno uložení přes Save Bar, jako v nativním Shopify. „Sčítá se s“ je součástí téhož uložení. Inline tlačítka „Uložit“ (pod formulářem i pod Sčítá se s) zmizí. Změna úrovně i Sčítá se s se uloží jedním potvrzením lišty, Zahodit vrátí obojí. Backend endpointy (akce stránky i /app/combine) zůstávají beze změny. Jak spojit odeslání (jeden formulář a obě akce postupně, nebo route akce volá obě integrace) vybere implementace. Podmínka: když jedna část selže, obrazovka to řekne a nic nevydává za uložené. Rozhodnutí Ondřeje, audit F3.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Na tiers i tiers?plan=pro není viditelný žádný submit mimo Save Bar (Playwright)
- [ ] E2E: změna úrovně + změna Sčítá se s → jedno uložení → po reloadu jsou obě uložené (harness: obě akce dostanou data)
- [ ] E2E: selhání jedné části ukáže chybu a druhá část netvrdí úspěch
- [ ] Skrytá a sbalená pole dál postují (doktrína §17d)
- [ ] V ticketu je přesný ruční postup ověření Save Baru v shopify app dev pro Ondřeje
- [ ] Rozhodnutý vzor spojení je popsaný v ticketu (pro 10 a 11)
