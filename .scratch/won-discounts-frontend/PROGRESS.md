# Postup implementace auditu frontendu

## CHECKPOINT

- **Hotové tickety:** 01
- **Rozdělaný:** 02 (testy podle funkce), nezačatý
- **Další krok:** 02: přejmenovat/rozdělit 7 souborů testů, odstranit čísla nálezů z názvů testů, porovnat počty
- **Čeká na Ondřeje:** nic
- **Baseline 2026-11-03 (před 01):** node testy 2038/2038, engine 720/720, typecheck čistý, lint 0 chyb / 4 varování
  (import/no-duplicates v themes.server.ts), E2E preview 48/48.
- **Harness:** `npx react-router dev --port 3411` (příkaz v README), log ve scratchpadu session.

## Log

| Ticket | Stav | Commit | Důkaz |
|---|---|---|---|
| 01 | done | viz git log | `docs/won-discounts/evidence/frontend-01/`, `tests/ui/readme-map.test.ts` |

## Pomůcky (scratchpad session, nejsou v repu)

- `gate.sh`: unit + typecheck + lint + E2E, souhrn. `evidence.sh NN obrazovky…`: capture všech 22 stavů,
  kopie vybraných do `docs/won-discounts/evidence/frontend-NN/` + metrics.json, kontrola HTTP/přetoku.
  Chyba „missing required configuration fields: shop“ je známé omezení harnessu.
