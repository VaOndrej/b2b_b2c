# 01: Mapa frontendu a glosář v README appky

**What to build:** Agent nebo vývojář najde ke každé položce menu a záložce (Přehled, Slevy a kódy, Množstevní slevy, Milníky, Výprodej, Kampaně, Umístění na webu, Ochrana marže, Vyzkoušet košík, Přehledy, Překlady, Nastavení, Onboarding) její route, obrazovku, části, model, integraci a testy bez hledání. README appky přestane začínat nadpisem „App template“. Glosář řeší tři jména jednoho pojmu (Milníky = rewards/milestones, Výprodej = outlet, Množstevní slevy = tiers, Sčítá se s = combine/combination, Vzhled = looks/appearance). Audit X1.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] README appky má nadpis Won Discounts a krátkou tabulku: CZ název → kódové jméno → route → obrazovka → model → testy
- [x] Popis vrstev (route → integrace → obrazovka → shell → model) a hranice backendu na pár řádcích
- [x] Každá cesta v tabulce existuje (ověřit skriptem nebo ručně) a žádný soubor se nepřejmenovává

## Důkaz

- `apps/won-discounts/README.md`: nadpis Won Discounts, mapa (17 řádků, mezi `<!-- map:start -->` a `<!-- map:end -->`), glosář, vrstvy a hranice backendu.
- Cesty hlídá `tests/ui/readme-map.test.ts` (3 testy: nadpis, všechny položky menu, každá cesta existuje). Žádný soubor nepřejmenován.
- Brána: node 2041/2041 (baseline 2038 + 3 nové), engine 720/720, typecheck 0, lint 0 chyb, E2E preview 48/48.
- Harness bez regresí: `docs/won-discounts/evidence/frontend-01/metrics.json` (44 stavů, HTTP 200, přetok 0) + `overview-390.png`, `overview-1440.png`.
