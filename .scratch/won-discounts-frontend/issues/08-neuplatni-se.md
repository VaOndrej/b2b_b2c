# 08: Tabulka slev: „Neuplatní se“ místo „Neaktivní“

**What to build:** Sleva, která je zapnutá, ale v pokladně se neuplatní, má v tabulce Slevy a kódy (a v řádcích, které používají stejný stav) štítek „Neuplatní se“. Vypnutá sleva dál „Vypnuto“. Slovník dlaždic se nemění. Rozhodnutí Ondřeje 2026-11-03, audit F11.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] cs „Neuplatní se“, en odpovídající překlad (např. „Not applied“)
- [ ] Záložky a filtr tabulky používají stejný text
- [ ] Vygenerovaná support reference je přegenerovaná (npm run docs:gen) a drift test zelený
- [ ] Testy stavu slevy zelené, screenshot discounts 1440
