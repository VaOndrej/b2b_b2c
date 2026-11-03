# 10: Jedno uložení: Milníky a Výprodej

**What to build:** Stejný vzor jako pilot 09 na Milnících a Výprodeji. Jedno uložení přes Save Bar včetně Sčítá se s, žádná inline „Uložit“. Výprodej má dnes osm formulářů: akce, které jsou jednorázové (Ukončit výprodej, Zkusit znovu, Nechat skončený), zůstávají tlačítky, nastavení jde přes Save Bar. Audit F3.

**Blocked by:** 09

**Status:** done, čeká na ruční ověření Save Baru

- [x] Na rewards a outlet (Free i Pro) žádný viditelný submit mimo Save Bar kromě jednorázových akcí
- [x] E2E jako v 09 pro obě stránky
- [x] Seznam jednorázových akcí, které zůstaly tlačítky, je v ticketu

## Důkaz

- Vzor z 09 (`shell/one-save.tsx`, `CombinePart`). Starý formulář `ModuleCombine` a texty `combine.module.save`,
  `outlet.settings.save` smazané, nikdo je nepoužíval.
- **Milníky** (`MilestonesScreen.tsx`): bez `PageSave`, formulář stránky s `onSubmit` jednoho uložení. Sčítá se s zůstává
  pod náhledem mimo formulář (posuvník náhledu nesmí být neuložená změna): zaškrtávátka bez jména, skrytá pole části
  (`part:combine:*`) v portálu uvnitř formuláře, formulář dostane `change` (stejný trik jako přepínač „Co se počítá“).
  Zahodit: remount podle `formKey`.
- **Výprodej** (`OutletScreen.tsx`): pohled „Nastavení výprodeje“ je jeden formulář se Save Barem (`data-won-outlet-settings`):
  Sčítá se s + Vratky po konci výprodeje (`intent=settings`). Bez tlačítek Uložit. Bez nastavení (Free bez běžícího
  výprodeje) formulář nemá vlastní pole a posílá jen Sčítá se s (`planSave`: prázdná stránka se neposílá).
- **Zůstaly tlačítky (jednorázové akce):** Spustit výprodej (formulář nového výprodeje, vytváří výprodej), Ukončit výprodej
  (s potvrzením), Zkusit znovu, Vrátit do výprodeje, Nechat skončený, Ukázat / Skrýt štítek u výprodeje.
- **Úpravy jednoho běžícího výprodeje** (Upravit zobrazení, Upravit slevy výprodeje): po kliknutí Upravit se otevře malý
  formulář s Uložit / Zrušit. Je to editor jedné věci (jako dialog), ne nastavení stránky, a ve výchozím stavu není vidět.
  Ponecháno, protože by to znamenalo jedno uložení přes víc výprodejů naráz. K rozhodnutí: převést na `s-modal`?
- Harness: Výprodej dostává výsledek akce jako ostatní obrazovky (dřív jen z fixture).
- Unit `one-save.test.ts` (+1 prázdná stránka). Upravené: `screen-consistency.test.ts` (Milníky bez PageSave, Vratky přes
  Save Bar), `markets-and-tiles.test.ts` (Milníky bez tlačítka). E2E `admin.one-save.spec.ts` +3: žádné „Uložit“ na Milnících
  a Výprodeji Free/Pro v pohledech; Milníky krok + Sčítá se s = 2 POSTy, Sčítá se s mimo formulář, Zahodit ho vrátí;
  Výprodej Vratky + Sčítá se s = 2 POSTy, odmítnuté Sčítá se s řekne „Neuloženo“. `admin.views.spec.ts`: Milníky bez PageSave.
- Brána: node 2050/2050 (známý flake marže 1× v prvním běhu, druhý běh zelený), engine 720/720, typecheck 0, lint 0 chyb,
  E2E preview 58/58.
- Screenshoty `docs/won-discounts/evidence/frontend-10/`: `rewards*`, `outlet*`, `outlet-settings-{390,1440}.png`.
- Mimo rozsah: vzhled (LookSection) na Milnících a štítek výprodeje mají dál vlastní formulář „Uložit vzhled“ (stejně jako
  na Množstevních slevách, viz 09).

## Ruční ověření Save Baru (Ondřej)

```bash
cd /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/apps/won-discounts && npm run dev
```

1. Slevy → Milníky: změň částku u stupně a zaškrtni typ v „Sčítá se s“ pod náhledem. Save Bar se objeví. Ulož, obnov
   stránku: obojí drží. Pohni posuvníkem náhledu: Save Bar se NEobjeví.
2. Milníky: změň Sčítá se s a klikni Zahodit: zaškrtnutí se vrátí.
3. Slevy → Výprodej → dlaždice „Nastavení“ (pohled s Vratkami): změň „Vratka po konci výprodeje“ a Sčítá se s, ulož,
   obnov: obojí drží.
4. Výprodej s běžícím výprodejem: Ukončit výprodej se dál ptá a Zkusit znovu funguje jedním kliknutím.
