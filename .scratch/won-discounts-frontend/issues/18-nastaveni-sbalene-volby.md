# 18: Nastavení: sbalené volby pro zákazníky mimo trhy

**What to build:** Sekce „Zákazník ze země mimo vaše trhy“ se ukazuje jako stavová věta. Pět selectů se vysvětlivkami se zobrazí po rozbalení. Když se obchodu netýká („žádné dva trhy nemají stejnou měnu“), je to první věta a volby jsou sbalené. Vysvětlení voleb je v textu možností, ne pod polem. Sbalená pole dál postují (§17d). Audit F6.

**Blocked by:** 11

**Status:** done

- [x] Výška settings na 390 px pod 3 500 px (baseline 4 220)
- [x] Uložení se sbalenou sekcí pošle stejné hodnoty jako dnes (test)
- [x] settings?markets=shared ukazuje volby jako relevantní
- [x] Screenshot 390 + 1440

## Důkaz

- `SettingsScreen.tsx`: sekce „Zákazník ze země mimo vaše trhy“ je sbalitelná. Když žádné dva trhy nemají stejnou měnu,
  je sbalená a její stavová věta je „Teď se vás to netýká: žádné dva vaše trhy nemají stejnou měnu.“ Při sdílené měně je
  otevřená a nahoře říká, kterých trhů se týká. Sbalení = skryto, ne odmontováno: pole dál postují (§17d).
- Vysvětlení voleb je v textu možností („Nejnižší z trhů (menší sleva)“, „Nejvyšší z trhů (doprava zdarma později)“),
  pět vět pod selecty pryč (`settings.unknownMarket.kind.*.note` → `*.lowest` / `*.highest`, cs + en).
- Výška Nastavení na 390 px: 3256 (baseline 4220, cíl < 3500). 1440 px: 2405.
- E2E `admin.views.spec.ts` „Nastavení: … folded“: sbalená na `settings` (aria-expanded false), výška < 3500, FormData má
  všech 5 voleb; na `settings?markets=shared` otevřená, volby s vysvětlením v textu, stejná jména polí jako sbalená.
  Unit `market-amounts.test.ts` upravený na text v možnostech.
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 65/65.
- Screenshoty `docs/won-discounts/evidence/frontend-18/`: `settings-{390,1440}`, `settings-shared-{390,1440}`.
