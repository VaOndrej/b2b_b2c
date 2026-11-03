# 20: Jeden štítek stavu místo tří

**What to build:** Jedna komponenta štítku stavu ve shellu nahradí tři dnešní implementace (StatusPill, CardPill, Pill). Barvy z tokenů, vzhled stejný jako dnes (vlastní vizuál zůstává). Stavy: Aktivní, Vyžaduje pozornost, Neuplatní se, Vypnuto, Naplánováno, Pro / Pro · odemknout, Jen přehled. Audit D1.

**Blocked by:** 08

**Status:** done

- [x] V kódu je jedna komponenta štítku, staré tři jsou smazané
- [x] Screenshoty všech 22 stavů harnessu před a po se ve štítcích neliší (porovnání capture.mjs)
- [x] Unit test mapování stav → text a tón

## Důkaz

- `shell/StatusBadge.tsx`: jedna komponenta štítku stavu. Vstup: stav modulu (`state`), stav slevy (`status`), přepínač
  (`on`), umístění v tématu (`placement` + `move`) nebo už pojmenovaný štítek (`badge`). Varianta `plain` je dnešní vzhled
  štítku u karty (výprodej, kampaň), aby se vzhled nezměnil. Barvy jen ve shellu.
- `model/status-badge.ts`: mapování stav → text a tón (`moduleBadge`, `ruleBadge`, `switchBadge`, `placementBadge`,
  `STATE_TONE` sdílený s tečkou `StatusDot`). Unit `tests/ui/status-badge.test.ts`: Aktivní, Vyžaduje pozornost, Neaktivní,
  Neuplatní se, Naplánováno, Vypnuto, umístění.
- Smazané: `StatusPill`, `Pill` (WonSection), `CardPill` (SubCard), i obaly `PlacementPill`, `NotePill`. Všech 11 míst
  volá `StatusBadge`. `git grep "StatusPill|CardPill|function Pill" -- app` → 0.
- Pro / Pro · odemknout dál kreslí `PlanBadge` (amber značka tarifu, ne stav), „Jen přehled“ dlaždice `won-tile-note`.
  Nesloučeno, protože to nejsou štítky stavu a mají vlastní rozhodnutý vzhled.
- Porovnání všech 44 stavů harnessu před (ticket 19) a po pixel po pixelu (`compare.py`, výsledek `compare-vs-19.txt`):
  4 snímky se liší v 0,001–0,003 % pixelů mimo štítky. Stejný šum vykreslování je i mezi dvěma snímky bez změny kódu
  (18 vs 19: onboarding, plan). Ve štítcích žádný rozdíl.
- Brána: node 2055/2055, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.
- Screenshoty `docs/won-discounts/evidence/frontend-20/`: discounts, overview, outlet, campaigns (390 + 1440), metrics.json.
