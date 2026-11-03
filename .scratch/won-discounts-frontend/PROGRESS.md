# Postup implementace auditu frontendu

## CHECKPOINT

- **Hotové tickety:** 01–11
- **Rozdělaný:** review skupiny 09–11 proti main
- **Další krok:** review 09–11, pak 12 (Přehled: pozornost seskupená podle příčiny)
- **Čeká na Ondřeje:** 07 formát data v adminu, 09, 10, 11 Save Bar v shopify app dev (postupy v ticketech); 10: per-run úpravy výprodeje na s-modal?
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
| 06 | done | 8de0344a | `evidence/frontend-06/`, E2E 50 |
| 07 | done, čeká na ruční ověření data | d5aaf8d4 | `evidence/frontend-07/` |
| 08 | done | 1d45a30c | `evidence/frontend-08/`, docs:gen |
| 09 | done, čeká na ruční ověření | 9a4bb437 | `evidence/frontend-09/`, E2E admin.one-save |
| 10 | done, čeká na ruční ověření | 2b5a65ca | `evidence/frontend-10/`, E2E 58 |
| 11 | done, čeká na ruční ověření | viz git log | `evidence/frontend-11/`, ADMIN-UX §2 |

## Pomůcky (scratchpad session, nejsou v repu)

- `gate.sh`: unit + typecheck + lint + E2E, souhrn. `evidence.sh NN obrazovky…`: capture všech 22 stavů,
  kopie vybraných do `docs/won-discounts/evidence/frontend-NN/` + metrics.json, kontrola HTTP/přetoku.
  `shot.mjs out name=cesta…`: screenshot 390+1440 libovolné cesty harnessu. `crop.mjs`: výřez PNG k prohlédnutí.
  Chyba „missing required configuration fields: shop“ je známé omezení harnessu.

## Otevřené mimo tickety

- Vzhled (LookSection) a Ceny na kartách mají dál vlastní formulář s „Uložit vzhled“ / „Uložit“ (Množstevní slevy, Milníky,
  Výprodej, Kampaně). Pole vzhledu mají stejná jména na víc místech, do jednoho uložení potřebují předponu části.
  Řešit při 11 nebo 25, jinak zapsat jako zbývající výjimku.

## Review skupiny 01–08 (proti main, 2026-11-03)

- Hranice: žádná změna v `lib/integration/**`, `*.server.ts`, Prisma, `extensions/`, `themes/`, routách. V testech backendu se
  měnily jen názvy testů (ticket 02).
- Nález (opraveno): maska pruhu záložek (06) se počítala jen při mountu, posunu a resize. Po načtení písma se záložky rozšíří
  a stav okrajů mohl být starý → přepočet i po `document.fonts.ready`.
- Přijaté riziko: `s-drop-zone` (05) po přečtení souboru nastavuje `files = []`; opakovaný výběr téhož souboru v harnessu
  neověřen. Text Polaris při přetahování („Drop files to upload“) v harnessu anglicky.
- Bez dalších nálezů: page-guides importuje jen čistý `model/combine.ts`, lint pravidlo je scoped na `apps/won-discounts`.
- Známý flake (není z této práce, backend se nemění): `tests/integration/margin.test.ts` „a loader never reads the catalogue…“
  padá zhruba 1× z 5 i samostatně (`impact.status` „updating“ místo „ready“, výpočet na pozadí vs. `settle()`). Při pádu
  se unit brána pouští znovu; opravu by měl udělat někdo, kdo smí sahat na backend.
