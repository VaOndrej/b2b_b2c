# 02: Testy pojmenované podle funkce

**What to build:** Z názvu testu je poznat, jakou funkci chrání. Testy pojmenované podle kol feedbacku (kolo3-a, kolo3-c, feedback-2026-10-12, audit-2026-10-06, pred-review, admin.feedback-2026-10-09, admin.pred-review) se rozdělí nebo přejmenují podle funkce. Obsah asercí se nemění. Audit X2.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Žádný soubor testu nemá v názvu kolo, feedback, audit ani pred-review
- [x] Počet testů v test:unit i test:e2e:preview je před a po stejný (výpis obou počtů v commitu)
- [x] Popisky describe/test říkají chování, ne číslo nálezu

## Důkaz

Přejmenování (obsah asercí beze změny):

| Dřív | Teď |
|---|---|
| `tests/ui/kolo3-a.test.ts` | `tests/ui/tiles.test.ts` |
| `tests/ui/kolo3-c.test.ts` | `tests/ui/tier-exceptions.test.ts` (+ test výjimky z feedback-2026-10-12) |
| `tests/ui/feedback-2026-10-12.test.ts` | `tests/ui/try-cart-combinations.test.ts` (2 testy košíku) |
| `tests/ui/audit-2026-10-06.test.ts` | `tests/ui/markets-and-tiles.test.ts` |
| `tests/ui/pred-review.test.ts` | `tests/ui/screen-consistency.test.ts` |
| `tests/e2e-preview/admin.pred-review.spec.ts` | `tests/e2e-preview/admin.views.spec.ts` |
| `tests/e2e-preview/admin.feedback-2026-10-09.spec.ts` | `tests/e2e-preview/admin.module-pages.spec.ts` |

- Z názvů testů zmizely předpony kol a nálezů („nález 7:“, „bod 4:“, „N2 + N4:“, „C14:“, „audit P1:“, „13 Oct 2026:“) v těchto
  souborech i v dalších 17 souborech testů (33 názvů). Hlavičky souborů říkají, co chrání, s odkazem na dokument.
- Počty před / po: node testy 2041 / 2041, engine 720 / 720, E2E preview 48 / 48. Typecheck 0, lint 0 chyb.
- `git grep -E '(test|it|describe)\("(nález|bod |N[0-9]+|C[0-9]+:|audit|feedback|[0-9]+ Oct 2026)' -- tests scripts` → 0.
- Mapa v README odkazuje na nová jména. Historické dokumenty (build log, matice-pred-review) zůstaly beze změny.
- Harness bez regresí: `docs/won-discounts/evidence/frontend-02/metrics.json`, `overview-390.png`, `overview-1440.png`.
