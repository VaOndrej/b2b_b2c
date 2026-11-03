# 16: Pro jednou na sekci: Množstevní slevy, Milníky, Výprodej

**What to build:** Stejné pravidlo jako 15 na stránkách modulů. Plný žlutý banner „Tohle je v tarifu Pro, zákazník to nedostane“ se změní na běžný varovný banner Polaris se stejným obsahem. Ve Výprodeji se Pro neopakuje ve větě PageGuide, na dlaždici a ve větě „Tarif Free: …“ zároveň. Dlaždice na Přehledu se štítkem Pro zůstávají beze změny. Audit F4.

**Blocked by:** 14

**Status:** done

- [x] Na tiers, rewards, outlet (Free) nejvýš jedna Pro zmínka na sekci
- [x] Banner uložených Pro nastavení má dál seznam dotčených věcí a odkaz na tarif
- [x] Screenshot 390 + 1440 Free i Pro

## Důkaz

- Banner uložených Pro nastavení (`shell/GateNotes.tsx`) už je běžný `s-banner tone="warning"` Polaris se seznamem dotčených
  věcí a tlačítkem „Zobrazit tarif Pro“. Beze změny, E2E hlídá seznam a odkaz.
- **Množstevní slevy, Výjimky** (`tiers/ProTierSets.tsx`): na Free bez štítku „Pro · odemknout“ v hlavičce sekce, jednou
  Pro je poznámka `ProSell` (štítek nese dlaždice nad ní). Uložené výjimky zůstávají jako řádky, které jdou odebrat.
  Na Pro sekce svůj jeden štítek má.
- **Výprodej, Nový výprodej** (`OutletScreen.tsx`): na Free bez štítku v hlavičce a bez zamčeného formuláře; jen poznámka
  s odkazem na tarif. PageGuide Výprodeje si štítek Pro nechává (rozhodnutí PageGuide), věta „Tarif Free: běžící výprodeje
  doběhnou…“ zůstává (je to stav obchodu, ne nabídka Pro), každá v jiné sekci.
- Milníky: Pro je v nich jen v banneru uložených Pro nastavení a ve vzhledu (jedna poznámka na sekci).
- Dlaždice na Přehledu se štítkem Pro beze změny.
- E2E `admin.views.spec.ts`: na tiers, rewards, outlet (Free) v žádné `section` víc než jeden štítek / Pro poznámka; banner má
  seznam a odkaz na tarif. Unit `tiles.test.ts` (tiers #pro a outlet #new: 0 štítků, 1 poznámka),
  `outlet-admin.test.ts` (Free bez zamčeného formuláře).
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 64/64.
- Screenshoty `docs/won-discounts/evidence/frontend-16/`: tiers, tiers-pro, rewards, rewards-pro, outlet, outlet-pro,
  `outlet-new-free-*`, `tiers-exceptions-free-*` (390 + 1440).
