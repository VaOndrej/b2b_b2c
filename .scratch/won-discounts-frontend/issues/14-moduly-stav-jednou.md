# 14: Moduly s dlaždicí: stav se v sekci neopakuje

**What to build:** Na Množstevních slevách, Výprodeji a Ochraně marže, kde dlaždice nese stav, ho sekce pod ní neopakuje. Nadpis sekce neopakuje název dlaždice ani větu PageGuide. Dnes je „Množstevní sleva pro celý obchod · Aktivní“ třikrát. Ve Výprodeji je chyba „Cenu se nepodařilo změnit“ dvakrát. Slovník a vzhled dlaždic se nemění. Audit F2.

**Blocked by:** 10

**Status:** done

- [x] Na tiers, outlet, margin (Free i Pro) je stav téže věci zmíněný jednou (Playwright)
- [x] Každá chyba výprodeje je na stránce jednou a u ní je akce
- [x] Screenshot 390 + 1440

## Důkaz

- **Množstevní slevy** (`TiersScreen.tsx`): nadpis sekce pod dlaždicí „Pro celý obchod“ je „Úrovně slevy“ (`tiers.global.levels`),
  ne znovu „Množstevní sleva pro celý obchod“. Řádek uložené slevy ukazuje jen co dává („Od 3 ks −10 %…“), bez názvu a bez
  štítku „Aktivní“ (štítek je na dlaždici). Dřív 3× stejný text a stav.
- **Ochrana marže** (`MarginScreen.tsx`): nadpis sekce „Hranice a co se sníží“ (`margin.settings.title`) místo „Ochrana marže“
  (nadpis stránky), podnadpis s větou PageGuide pryč.
- **Výprodej** (`OutletScreen.tsx`): souhrn „K vyřešení“ pryč. Každá chyba je jednou, na kartě výprodeje, a u ní akce
  (Zkusit znovu, Ukončit, Vrátit do výprodeje / Nechat skončený). Dlaždice Výprodeje dál počítá „2 věci k vyřešení“ se
  štítkem. Klíče `outlet.todo.*` smazané.
- Slovník a vzhled dlaždic beze změny.
- E2E `admin.state-once.spec.ts` „module pages with tiles…“ (Free i Pro): tiers bez „Množstevní sleva pro celý obchod“ a bez
  štítku v řádku, štítek na dlaždici jednou; marže bez věty PageGuide v sekci; výprodej „Cenu se nepodařilo změnit“ 1×,
  „K vyřešení“ 0×, u chyby „Zkusit znovu“. Upravené: `harness-screens.test.ts`, `markets-and-tiles.test.ts`,
  `admin.module-pages.spec.ts` (štítek z řádku na dlaždici).
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 62/62.
- Screenshoty `docs/won-discounts/evidence/frontend-14/`: tiers, tiers-pro, outlet, outlet-pro, margin, margin-pro (390 + 1440).
