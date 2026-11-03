# Postup implementace auditu frontendu

## CHECKPOINT

- **Hotové tickety:** 01–06
- **Rozdělaný:** 07 (editor: kroky jen u nové slevy), nezačatý
- **Další krok:** 07: číslování sekcí editoru jen u nové slevy, zapsat zjištění k formátu data
- **Čeká na Ondřeje:** nic
- **Baseline 2026-11-03 (před 01):** node testy 2038/2038, engine 720/720, typecheck čistý, lint 0 chyb / 4 varování
  (import/no-duplicates v themes.server.ts), E2E preview 48/48 (od 05: 49).
- **Harness:** `npx react-router dev --port 3411` (příkaz v README), log ve scratchpadu session.

## Log

| Ticket | Stav | Commit | Důkaz |
|---|---|---|---|
| 01 | done | 611ab3a5 | `docs/won-discounts/evidence/frontend-01/`, `tests/ui/readme-map.test.ts` |
| 02 | done | 7f1821a5 | počty testů v ticketu, `evidence/frontend-02/` |
| 03 | done | 165f12e8 | lint 54 varování výchozí stav, `evidence/frontend-03/` |
| 04 | done | 440d5f01 | `evidence/frontend-04/`, `tests/ui/page-guide.test.ts` |
| 05 | done | ff5ea0c8 | `evidence/frontend-05/`, E2E 49 |
| 06 | done | viz git log | `evidence/frontend-06/`, E2E 50 |

## Pomůcky (scratchpad session, nejsou v repu)

- `gate.sh`: unit + typecheck + lint + E2E, souhrn. `evidence.sh NN obrazovky…`: capture všech 22 stavů,
  kopie vybraných do `docs/won-discounts/evidence/frontend-NN/` + metrics.json, kontrola HTTP/přetoku.
  `shot.mjs out name=cesta…`: screenshot 390+1440 libovolné cesty harnessu. `crop.mjs`: výřez PNG k prohlédnutí.
  Chyba „missing required configuration fields: shop“ je známé omezení harnessu.
