# 19: Výprodej: jeden řádek pro všechny stavy

**What to build:** Aktivní i skončené výprodeje mají stejný řádek (stejné údaje: produkt, cena, zbývá, konec, na webu teď, stav). Detail, problémy a historie kroků jsou v rozbalení řádku. Problém = štítek stavu + věta v rozbalení s akcí, ne jiné rozvržení karty. Všechny dnešní akce (Podrobnosti, Ukončit výprodej, Zkusit znovu, Nechat skončený, Historie kroků) zůstávají dosažitelné. Audit F9.

**Blocked by:** 16

**Status:** done

- [x] outlet i outlet?plan=pro: všechny výprodeje mají stejnou strukturu řádku (Playwright)
- [x] Každá dnešní akce je dosažitelná myší i klávesnicí
- [x] Ukončení výprodeje se dál ptá před provedením
- [x] Screenshot 390 + 1440

## Důkaz

- `OutletScreen.tsx` `RunCard`: běžící, vracející se i skončený výprodej mají stejný řádek se stejnými sloupci (Produkt se
  štítkem stavu, Cena, Zbývá, Konec, Na webu teď) a tlačítko Podrobnosti. Druhé rozvržení (karta `SubCard` pro neaktivní)
  je pryč. U neaktivního výprodeje „Konec“ = kdy skončil, „Na webu teď“ = „—“.
- Problém = štítek stavu + červený rámeček řádku + věta s akcí v rozbalení (Zkusit znovu; Znovu otevřít / Nechat skončený;
  Ukončit u přeprodaného). Rozbalení se samo otevře, když výprodej čeká na rozhodnutí.
- Akce dosažitelné: Podrobnosti, Ukončit výprodej (dál s potvrzením v `s-modal`), Zkusit znovu, Znovu otevřít, Nechat
  skončený, Historie kroků (`<details>`), Upravit zobrazení / slevy výprodeje u běžícího.
- E2E `admin.views.spec.ts` „Výprodej: every sale is the same row…“ (Free i Pro): ≥3 řádky se stejným počtem sloupců,
  Ukončit otevře dialog, Podrobnosti jdou otevřít klávesnicí (Enter), všechny akce jsou na stránce.
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.
- Screenshoty `docs/won-discounts/evidence/frontend-19/`: `outlet-*`, `outlet-pro-*`, `sales-pro-*`, `ended-pro-*` (390 + 1440).
