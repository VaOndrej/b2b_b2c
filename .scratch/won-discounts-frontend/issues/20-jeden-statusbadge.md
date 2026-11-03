# 20: Jeden štítek stavu místo tří

**What to build:** Jedna komponenta štítku stavu ve shellu nahradí tři dnešní implementace (StatusPill, CardPill, Pill). Barvy z tokenů, vzhled stejný jako dnes (vlastní vizuál zůstává). Stavy: Aktivní, Vyžaduje pozornost, Neuplatní se, Vypnuto, Naplánováno, Pro / Pro · odemknout, Jen přehled. Audit D1.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] V kódu je jedna komponenta štítku, staré tři jsou smazané
- [ ] Screenshoty všech 22 stavů harnessu před a po se ve štítcích neliší (porovnání capture.mjs)
- [ ] Unit test mapování stav → text a tón
