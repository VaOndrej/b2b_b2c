# 19: Výprodej: jeden řádek pro všechny stavy

**What to build:** Aktivní i skončené výprodeje mají stejný řádek (stejné údaje: produkt, cena, zbývá, konec, na webu teď, stav). Detail, problémy a historie kroků jsou v rozbalení řádku. Problém = štítek stavu + věta v rozbalení s akcí, ne jiné rozvržení karty. Všechny dnešní akce (Podrobnosti, Ukončit výprodej, Zkusit znovu, Nechat skončený, Historie kroků) zůstávají dosažitelné. Audit F9.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] outlet i outlet?plan=pro: všechny výprodeje mají stejnou strukturu řádku (Playwright)
- [ ] Každá dnešní akce je dosažitelná myší i klávesnicí
- [ ] Ukončení výprodeje se dál ptá před provedením
- [ ] Screenshot 390 + 1440
