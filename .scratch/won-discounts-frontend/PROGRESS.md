# Postup implementace auditu frontendu

## CHECKPOINT

- **Hotové tickety:** 01–24
- **Rozdělaný:** 25 (uzavření: lint error, výjimky, finální capture), nezačatý
- **Další krok:** 25: lint barev na error, ADMIN-UX §1 výjimky, smazat nepoužívané, finální capture vs baseline auditu, build; pak review 20–25
- **Čeká na Ondřeje:** 07 formát data v adminu, 09, 10, 11 Save Bar v shopify app dev (postupy v ticketech); 10: per-run úpravy výprodeje na s-modal?; 17: přijmout −14 % slov u Marže a 0 % u Překladů?; 23: hlavní soubory Výprodeje/Kampaní/Milníků 583–679 ř.
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
| 11 | done, čeká na ruční ověření | 18557663 | `evidence/frontend-11/`, ADMIN-UX §2 |
| 12 | done | a39b3eee | `evidence/frontend-12/`, E2E admin.state-once |
| 13 | done | e67ed844 | `evidence/frontend-13/` |
| 14 | done | 65740cd4 | `evidence/frontend-14/` |
| 15 | done | 1b169162 | `evidence/frontend-15/` |
| 16 | done | 2bc2bf2b | `evidence/frontend-16/` |
| 17 | done, slova jen částečně | 126b66b0 | `evidence/frontend-17/` |
| 18 | done | 59096c7f | `evidence/frontend-18/` |
| 19 | done | d545a1e9 | `evidence/frontend-19/` |
| 20 | done | feb04382 | `evidence/frontend-20/` + compare-vs-19.txt |
| 21 | done | 643737f7 | `evidence/frontend-21/` |
| 22 | done | b1487706 | `evidence/frontend-22/` |
| 23 | done, velikost souborů částečně | f6978122 | `evidence/frontend-23/` |
| 24 | done | viz git log | `evidence/frontend-24/` |

## Pomůcky (scratchpad session, nejsou v repu)

- `gate.sh`: unit + typecheck + lint + E2E, souhrn. `evidence.sh NN obrazovky…`: capture všech 22 stavů,
  kopie vybraných do `docs/won-discounts/evidence/frontend-NN/` + metrics.json, kontrola HTTP/přetoku.
  `shot.mjs out name=cesta…`: screenshot 390+1440 libovolné cesty harnessu. `crop.mjs`: výřez PNG k prohlédnutí.
  `compare.py před po`: pixelové porovnání PNG (kopie v evidence/frontend-20/). Šum vykreslování ~0,001–0,01 % px.
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

## Review skupiny 09–11 (proti main, 2026-11-03)

- Hranice: žádná změna backendu, rout `app.*` ani webhooků. Měnil se jen harness (`dev.preview.$.tsx`: `?save=ok`,
  `?save=combine-fails`, výsledek akce i pro Výprodej).
- Nález (opraveno): odmítnutí části se drželo v mapě modulu a po návratu na stránku by se ukázalo znovu → jen stav komponenty
  (odmítnutá část nic neuloží, stránka se po ní neremountuje).
- Nález (opraveno): na Milnících se základ změn četl dřív, než portál přidal skrytá pole Sčítá se s → Sčítá se s by šlo
  při každém uložení. Základ se čte o snímek později; nový E2E „a step alone changed posts only the page“.
- Přijaté riziko: řetěz uložení je v modulu (`chains`); když obchodník odejde ze stránky uprostřed ukládání, zůstane tam,
  dokud ho nepřepíše další uložení stejné stránky. Neškodí (čeká na výsledek, který nepřijde).
- Neověřeno: skutečný Save Bar App Bridge (ruční postupy v ticketech 09–11).

## Review skupiny 12–14 (2026-11-03)

- Hranice: backend, routy a webhooky beze změny.
- Texty skupin na Přehledu pokrývají všech 5 druhů upozornění (`RuleWarningKind`). Bez nálezů k opravě.
- Přijato: na Přehledu dlaždice bez počtu jen když seznam drží všechny její věci; jinak počet zůstává (poctivější než 0).

## Review skupiny 15–19 (2026-11-03)

- Hranice: backend, routy a webhooky beze změny (`git diff 65740cd4..HEAD`).
- Odeslaná data: editor na Free a Nastavení posílají stejná pole jako dřív (E2E porovnává FormData).
- Nález (opraveno už v 19): sloupec „Na webu teď“ ukazoval u skončeného výprodeje stav štítku na webu.
- Otevřené k rozhodnutí: 17 (−20 % slov u Marže a Překladů nesplněno), 10 (úprava jednoho výprodeje na s-modal?).
