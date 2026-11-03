# 24: Převod obrazovek, dávka C: Marže, Vyzkoušet košík, Přehledy, Překlady, Umístění, Nastavení

**What to build:** Stejně jako 22 pro zbylé obrazovky. Vzhled se nemění. Audit D1, D2, D3.

**Blocked by:** 18, 21

**Status:** done

- [x] Lint bez varování o barvách v těchto obrazovkách
- [x] Screenshoty před a po stejné, testy zelené

## Důkaz

- Barvy z tokenů (skript `codemod.py` z ticketu 23): Ochrana marže (`margin/MarginProof`), Vyzkoušet košík (`TryCartScreen`,
  `try-cart/CombinationsSection`), Přehledy (`AnalyticsScreen`), Překlady, vzhled (`looks/AccentPicker`, `LookPreview`,
  `LookSection`). Umístění, Nastavení a Tarif barvy neměly. Lint: 0 varování o barvách v celém `app/components` mimo shell
  (`npm run lint` → 4 varování, všechna starší `import/no-duplicates` v `themes.server.ts`).
- Poslední surové prvky mimo shell: výběr barvy (`AccentPicker`, `CardRadio`) a slevy ručního košíku (`TryCartScreen`,
  `CardCheckbox`) → `shell/Controls.tsx`. `git grep "<(button|input|select|textarea)" mimo shell` (bez skrytých polí) → 0.
- Pixelové porovnání 44 stavů s ticketem 23 (`compare-vs-23.txt`): 3 snímky, 0,001–0,003 % pixelů, šum.
- `TryCartScreen.tsx` má 794 ř. (D3: dělit při skutečné úpravě, ticket 24 to nevyžaduje).
- Brána: node 2057/2057, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 66/66.
- Screenshoty `docs/won-discounts/evidence/frontend-24/`: margin-pro, try-cart, analytics, translations, placements, settings.
