# 09: Jedno uložení, pilot: Množstevní slevy

**What to build:** Na Množstevních slevách je jedno uložení přes Save Bar, jako v nativním Shopify. „Sčítá se s“ je součástí téhož uložení. Inline tlačítka „Uložit“ (pod formulářem i pod Sčítá se s) zmizí. Změna úrovně i Sčítá se s se uloží jedním potvrzením lišty, Zahodit vrátí obojí. Backend endpointy (akce stránky i /app/combine) zůstávají beze změny. Jak spojit odeslání (jeden formulář a obě akce postupně, nebo route akce volá obě integrace) vybere implementace. Podmínka: když jedna část selže, obrazovka to řekne a nic nevydává za uložené. Rozhodnutí Ondřeje, audit F3.

**Blocked by:** None (can start immediately)

**Status:** done, čeká na ruční ověření Save Baru

- [x] Na tiers i tiers?plan=pro není viditelný žádný submit mimo Save Bar (Playwright)
- [x] E2E: změna úrovně + změna Sčítá se s → jedno uložení → po reloadu jsou obě uložené (harness: obě akce dostanou data)
- [x] E2E: selhání jedné části ukáže chybu a druhá část netvrdí úspěch
- [x] Skrytá a sbalená pole dál postují (doktrína §17d)
- [x] V ticketu je přesný ruční postup ověření Save Baru v shopify app dev pro Ondřeje
- [x] Rozhodnutý vzor spojení je popsaný v ticketu (pro 10 a 11)

## Rozhodnutý vzor spojení (pro 10 a 11)

- **Jeden formulář se Save Barem** (`<Form data-save-bar onSubmit={oneSave.onSubmit}>`). Dokumentace App Bridge popisuje
  `data-save-bar` po jednom formuláři a dovoluje `preventDefault()` v submitu pro vlastní uložení; víc formulářů se Save
  Barem na stránce nepopisuje, proto jeden.
- **Část stránky s vlastní akcí** (Sčítá se s) je uvnitř formuláře, její pole mají předponu `part:<klíč>:` (`model/one-save.ts`
  `partField`). Save Bar tak vidí její změny a Zahodit ji vrátí (reset formuláře).
- **Při uložení** (`shell/one-save.tsx` `useOneSave`): formulář se rozdělí (`splitSave`) na pole stránky a pole částí,
  `planSave` porovná s formulářem po načtení a pošle jen to, co se změnilo:
  1. pole stránky na akci routy, přesně jako dřív (výsledek je `useActionData` routy);
  2. po úspěchu stránky každá změněná část na svou dnešní akci (`/app/combine`) s poli svého starého formuláře
     (`intent=save`, `combineModule`, `configVersion`, `combinePosted`, `combineTypes`), jedna po druhé na jednom fetcheru.
  Změnila se jen část: stránka se neposílá. Nic se nezměnilo: jen stránka (jako vždy).
- **Selhání:** stránka odmítnuta → žádná část se neposílá, zaškrtnutí zůstane ve formuláři neuložené. Část odmítnuta →
  `PartRefusal` nahoře: „Neuloženo: Sčítá se s“, důvod z akce a co se po ní už neposlalo. Nic netvrdí „Uloženo“ za část.
- **Proč to drží kontrakty:** obě akce kontrolují verzi jen pro svou část configu (`saveConfigSection`, F12 porovnává
  `pick` části), takže dvě postupná uložení se stejným `configVersion` si nepřekáží. Backend ani tvar dat beze změny.
- **Řetěz přežije remount:** route klíčuje obrazovku verzí configu, po uložení se stránka znovu připojí; řetěz je v modulu
  `one-save.tsx`, ne v komponentě.
- Harness: `?save=ok` (akce odpoví uloženo), `?save=combine-fails` (Sčítá se s odmítnuto „busy“).

## Důkaz

- `TiersScreen.tsx`: bez `PageSave` a bez formuláře `ModuleCombine`; `CombinePart` uvnitř formuláře stránky (pohled „Pro celý obchod“).
  `replaceUnreadable` posílá jen pole stránky.
- Unit `tests/ui/one-save.test.ts` (rozdělení, porovnání, plán). `harness-screens.test.ts`: formulář Množstevních slev má
  Save Bar, žádný submit a Sčítá se s jako část. `screen-consistency.test.ts`: tiers bez PageSave.
- E2E `tests/e2e-preview/admin.one-save.spec.ts` (5): žádné Uložit na Free/Pro v pohledech Pro celý obchod a Výjimky;
  úroveň + Sčítá se s = dva POSTy (stránka bez polí části, `/app/combine` s poli starého formuláře a bez polí stránky);
  jen Sčítá se s = jen jeden POST; odmítnutá část ukáže „Neuloženo: Sčítá se s“; odmítnutá stránka nepošle část a zaškrtnutí
  zůstane; Zahodit vrátí zaškrtnutí. `admin.views.spec.ts` upravený: tiers nemá PageSave.
- Skrytá a sbalená pole: pole stránky jdou ze stejného formuláře jako dřív (zavřený editor dál postuje úrovně, hlídá
  existující E2E „whole-store discount is a list“).
- Brána: node 2049/2049, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 55/55.
- Screenshoty `docs/won-discounts/evidence/frontend-09/`: `tiers-{390,1440}`, `tiers-pro-{390,1440}`, `tiers-combine-fails-*`.
- Mimo rozsah 09: Vzhled tabulky a Ceny na kartách v pohledu „Tabulka na webu“ mají dál vlastní formulář a „Uložit vzhled“ /
  „Uložit“. Řeší se v ticketu 11 stejným vzorem (pole vzhledu mají stejná jména jako na Milnících, potřebují předponu).

## Ruční ověření Save Baru (Ondřej)

```bash
cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts && npm run dev
```

V dev obchodě otevři Won Discounts → Slevy → Množstevní slevy:
1. Změň číslo v úrovni (Upravit) a zaškrtni nebo odškrtni jeden typ v „Sčítá se s“. Nahoře se musí objevit Save Bar.
2. Klikni Uložit v Save Baru. Po uložení: hláška Uloženo, Save Bar zmizí. Obnov stránku (F5): úroveň i Sčítá se s jsou uložené.
3. Změň znovu obojí a klikni Zahodit: úroveň i zaškrtnutí se vrátí na uložené.
4. Změň jen Sčítá se s a ulož: obnov stránku, zaškrtnutí drží, úrovně beze změny.
5. Změň úroveň, klikni na jinou záložku (Milníky): Shopify se zeptá na neuložené změny.
Když cokoli z toho nesedí, napiš číslo kroku.
