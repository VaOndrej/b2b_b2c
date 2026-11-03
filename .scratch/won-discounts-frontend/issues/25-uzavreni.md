# 25: Uzavření: lint jako chyba, výjimky jen ve shellu (contract)

**What to build:** Barvy mimo shell jsou chyba lintu. Surové HTML ovládací prvky existují jen jako zdokumentované výjimky ve shellu. Nepoužívané staré komponenty a styly jsou smazané. ADMIN-UX-PRINCIPLES popisuje skutečnost (výjimky z §1). Audit D1, D2, X3.

**Blocked by:** 22, 23, 24

**Status:** done

- [x] Lint pravidlo je error a npm run lint je zelený
- [x] Surové button/input/select mimo shell: 0 (grep výstup v ticketu)
- [x] Finální capture.mjs všech 22 stavů 390 + 1440 porovnané s baseline auditu
- [x] Celá brána zelená: test:unit, typecheck, lint, build, test:e2e:preview

## Důkaz

- `.eslintrc.cjs`: pravidlo na hex a `rgb/rgba(` v `apps/won-discounts/app/components/**/*.tsx` mimo `shell/` je `error`.
  `npm run lint`: 0 chyb, 4 varování (všechna starší `import/no-duplicates` v `lib/integration/themes.server.ts`, backend).
- Surové prvky mimo shell (bez skrytých polí formuláře):
  `git grep -nE "<(button|input|select|textarea)[ >/]" -- app/components ':!app/components/shell' | grep -v 'type="hidden"' | wc -l` → **0**.
  Výjimky jsou ve shellu se zdůvodněním: `ModuleTile`, `SegmentedChoice`, `RuleTable`, `Controls`, `StatusBadge`, `Surface`.
- Smazané nepoužívané: `components/RuleRow.tsx` (nahradila ho tabulka), `shell/JumpRow.tsx` (jen jeho test), dříve
  `shell/PageSave.tsx` (11), `ModuleCombine` form (10), `StatusPill`/`CardPill`/`Pill` (20). `shell/Surface.tsx` zůstává:
  nová plocha z ticketu 21 s testem, obrazovky zatím převedly barvy přes tokeny, ne přes `Card`.
- `apps/won-discounts/docs/ADMIN-UX-PRINCIPLES.md` §1: výjimky z „jen s-*“ jsou vypsané (kde a proč), §2 jedno uložení (11).
- Finální capture všech 22 stavů × 390 + 1440: `docs/won-discounts/evidence/frontend-25/` (44 PNG + metrics.json), srovnání
  s baseline auditu v `vs-audit-baseline.md`: všech 44 HTTP 200, vodorovný přetok 0. Např. Přehled 390 px 3117 → 2576,
  Nastavení 390 px 4220 → 3256.
- Celá brána: test:unit node 2056/2056 + engine 720/720, typecheck 0, lint 0 chyb, `npm run build` OK, E2E preview 66/66.
- Nesplněno z auditu (mimo kritéria ticketu): počet `style={{` v `screens/` 220 → 213, ne na polovinu (D1). Barvy jsou
  z tokenů, rozvržení zůstalo inline.
