# 17: Pod PageGuide žádný duplicitní výklad

**What to build:** Kde je PageGuide, pod ním není další úvodní odstavec. Na obrazovce je jedna číselná ukázka. Ochrana marže má dnes tři různé příklady (PageGuide 1000/500/−60 %, sekce 1000/600/−50 %, nápověda polí). Zůstane živý příklad v sekci a PageGuide použije stejná čísla. Překlady neopakují větu PageGuide. Množstevní slevy a editor slevy zkrátí odstavce mechaniky na jednu řádku s odkazem. PageGuide samotný zůstává. Audit F5.

**Blocked by:** 14

**Status:** done, kritérium −20 % slov splněné částečně, přijato Ondřejem 2026-11-03

- [ ] Počet slov (capture.mjs metrics.json) klesne u margin, translations, tiers aspoň o 20 %
- [x] Žádná obrazovka nemá dvě různé číselné ukázky
- [x] E2E PageGuide zelené
- [x] Screenshot 390 + 1440

## Důkaz

- **Ochrana marže:** jedna číselná ukázka. PageGuide převzal čísla živého příkladu v sekci (1 000 Kč, nákup 600 Kč, −50 % →
  „750 Kč, ne 500 Kč“, cs i en). Třetí příklad („Příklad: celý obchod má nejvyšší slevu 50 %…“) v Nastavení podle kolekcí
  pryč. Pod PageGuide pryč „Ochrana nikdy neblokuje objednávku…“ (říká krok 3 PageGuide) a „Stačí zapnout a uložit…“.
- **Překlady:** úvod pod PageGuide neopakuje jeho větu, zůstalo jen jak pole vyplnit.
- **Množstevní slevy:** tři odstavce mechaniky (sčítání, marže, výprodej) jsou jedna řádka s odkazy na Sčítá se s a Ochranu
  marže. Nápověda sekce „Platí pro všechny produkty kromě výjimek.“ (výjimky už nejsou „níž“, mají vlastní dlaždici).
- **Editor slevy:** odstavec nad zaškrtávátky Sčítá se s a věta o limitu pod nimi zůstaly (dvě různé informace); nezkracováno.
- PageGuide sám beze změny, E2E PageGuide zelené (`tests/ui/page-guide.test.ts` ukázka Marže 750 Kč).

### Kritérium „slova −20 %“: nesplněné u Marže a Překladů

| Obrazovka (1440) | Baseline | Teď | Pokles |
|---|---|---|---|
| margin | 236 | 204 | 14 % |
| margin?plan=pro | 235 | 203 | 14 % |
| translations | 510 | 508 | 0 % |
| tiers | 374 | 307 | 18 % |
| tiers?plan=pro | 337 | 270 | 20 % |

Proč: zbytek slov tvoří rozhodnuté části (PageGuide, dlaždice pohledů) a u Překladů samotné texty k překladu ve dvou
jazycích (~430 slov). Další škrt by bral obsah, ne duplicitu. K rozhodnutí: přijmout, nebo zkrátit PageGuide / dlaždice.

- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 64/64.
- Screenshoty a metrics: `docs/won-discounts/evidence/frontend-17/`.

## Rozhodnutí Ondřeje 2026-11-03

- Částečné splnění přijato, nic dalšího se nedělá.
