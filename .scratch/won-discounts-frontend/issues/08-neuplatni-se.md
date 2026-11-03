# 08: Tabulka slev: „Neuplatní se“ místo „Neaktivní“

**What to build:** Sleva, která je zapnutá, ale v pokladně se neuplatní, má v tabulce Slevy a kódy (a v řádcích, které používají stejný stav) štítek „Neuplatní se“. Vypnutá sleva dál „Vypnuto“. Slovník dlaždic se nemění. Rozhodnutí Ondřeje 2026-11-03, audit F11.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] cs „Neuplatní se“, en odpovídající překlad (např. „Not applied“)
- [x] Záložky a filtr tabulky používají stejný text
- [x] Vygenerovaná support reference je přegenerovaná (npm run docs:gen) a drift test zelený
- [x] Testy stavu slevy zelené, screenshot discounts 1440

## Důkaz

- Stav slevy „zapnutá, ale v pokladně se neuplatní“ (`status.unsupported` a jeho věty `status.*Text`): cs „Neuplatní se“,
  en „Not applied“. Platí všude, kde se kreslí stav slevy (tabulka Slevy a kódy, hlavička editoru, Aktivní slevy na Přehledu),
  protože jde o tentýž stav z `model/rule-status.ts`. „Vypnuto“ beze změny. Slovník dlaždic a modulů (`common.inactive`
  „Neaktivní“, doktrína §19a) beze změny.
- Záložky tabulky (Vše, Vyžaduje pozornost, Aktivní, Naplánované, Vypnuté) ani filtr „Způsob“ text „Neaktivní“ nikdy neměly,
  sleva, která se neuplatní, je pod „Vyžaduje pozornost“. Není co sjednocovat.
- Věta segmentů přeformulovaná, ať neříká „neuplatní“ dvakrát: „Neuplatní se: pokladna zatím neumí slevu jen pro skupiny zákazníků“.
- `npm run docs:gen`: přegenerované `docs/reference/discount-statuses.generated.md` a `docs/dist/corpus.jsonl`; drift test
  (`tests/docs/`) zelený v unit bráně.
- Testy upravené na nový text: `rule-status.test.ts`, `f2-admin.test.ts`, `harness-screens.test.ts`, název testu v `overview-model.test.ts`.
- Brána: node 2044/2044, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 50/50.
- Screenshoty: `docs/won-discounts/evidence/frontend-08/discounts-{390,1440}.png`, `discounts-attention-*`, `rule-edit-*`.
