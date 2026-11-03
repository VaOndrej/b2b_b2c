# 21: Shell: základní komponenty bez inline barev (expand)

**What to build:** Shell nabídne komponenty, ze kterých se obrazovky dají složit bez vlastních barev a stylů. Karta nebo dlaždice (včetně výběru a Pro vzhledu), řádek s akcí, poznámka Pro, rozvržení dvou sloupců s náhledem. Staré cesty zůstávají, nic se nerozbije. Výjimky vlastního vizuálu (README) žijí jen tady. Audit D1, D2, první krok expand–contract.

**Blocked by:** 03, 20

**Status:** done

- [x] Nové komponenty mají krátký komentář, kdy je použít, a jsou v mapě z ticketu 01
- [x] Žádná obrazovka se zatím nemění, všechny testy zelené
- [x] Seznam výjimek vlastního vizuálu je zapsaný u komponent

## Důkaz

- `shell/tokens.ts`: pojmenované odstíny, které obrazovky dosud psaly natvrdo (výběr `WON_SELECT_TINT/EDGE/RING`, okraj
  ovládacího prvku `WON_CONTROL_EDGE`, čárkovaný rámeček `WON_DASH`, pozornost `WON_ATTENTION_EDGE`, zelená ve větě
  `WON_LIVE_TEXT/TINT/EDGE`, vzorek obchodu `WON_SAMPLE_INK/PAPER`, výplně `WON_TRACK/CHIP/PANEL`…). Stejné hodnoty, jen jméno.
- `shell/Surface.tsx` (nový): `Card` (tóny plain, quiet, attention, pro, scheduled, dashed + `selected`), `selectableStyle(on)`,
  `TwoColumns` (nastavení + náhled, na úzké šířce pod sebou). Komentáře říkají, kdy kterou použít.
- Seznam výjimek vlastního vizuálu je v hlavičce `Surface.tsx` (amber Pro, červený rámeček pozornosti, modrý výběr, světle
  oranžové Naplánováno, klikací dlaždice a segmentová volba jako surové tlačítko).
- Řádek s akcí (`WonRow`), poznámka Pro (`ProSell`) a štítek (`StatusBadge`) už ve shellu jsou; mapa v README appky má
  novou tabulku „Shell: odkud se skládá vzhled“ (cesty hlídá `readme-map.test.ts`).
- Žádná obrazovka se nemění: porovnání 44 stavů s ticketem 20 (`compare-vs-20.txt`) jen šum vykreslování.
- Unit `tests/ui/surface.test.ts`. Brána: node 2057/2057, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.
