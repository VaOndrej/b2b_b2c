# Postup implementace auditu frontendu

## CHECKPOINT

- **Hotové tickety:** 01, 02, 03, 04
- **Rozdělaný:** 05 (Překlady CSV prvky Polaris), nezačatý
- **Další krok:** 05: Export a import v Překladech přes s-* prvky, E2E CSV beze změny chování
- **Čeká na Ondřeje:** nic
- **Baseline 2026-11-03 (před 01):** node testy 2038/2038, engine 720/720, typecheck čistý, lint 0 chyb / 4 varování
  (import/no-duplicates v themes.server.ts), E2E preview 48/48.
- **Harness:** `npx react-router dev --port 3411` (příkaz v README), log ve scratchpadu session.

## Log

| Ticket | Stav | Commit | Důkaz |
|---|---|---|---|
| 01 | done | 611ab3a5 | `docs/won-discounts/evidence/frontend-01/`, `tests/ui/readme-map.test.ts` |
| 02 | done | 7f1821a5 | počty testů v ticketu, `evidence/frontend-02/` |
| 03 | done | 165f12e8 | lint 54 varování výchozí stav, `evidence/frontend-03/` |
| 04 | done | viz git log | `evidence/frontend-04/`, `tests/ui/page-guide.test.ts` |

## Pomůcky (scratchpad session, nejsou v repu)

- `gate.sh`: unit + typecheck + lint + E2E, souhrn. `evidence.sh NN obrazovky…`: capture všech 22 stavů,
  kopie vybraných do `docs/won-discounts/evidence/frontend-NN/` + metrics.json, kontrola HTTP/přetoku.
  `shot.mjs out name=cesta…`: screenshot 390+1440 libovolné cesty harnessu. `crop.mjs`: výřez PNG k prohlédnutí.
  Chyba „missing required configuration fields: shop“ je známé omezení harnessu.
