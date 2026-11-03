# 25: Uzavření: lint jako chyba, výjimky jen ve shellu (contract)

**What to build:** Barvy mimo shell jsou chyba lintu. Surové HTML ovládací prvky existují jen jako zdokumentované výjimky ve shellu. Nepoužívané staré komponenty a styly jsou smazané. ADMIN-UX-PRINCIPLES popisuje skutečnost (výjimky z §1). Audit D1, D2, X3.

**Blocked by:** 22, 23, 24

**Status:** ready-for-agent

- [ ] Lint pravidlo je error a npm run lint je zelený
- [ ] Surové button/input/select mimo shell: 0 (grep výstup v ticketu)
- [ ] Finální capture.mjs všech 22 stavů 390 + 1440 porovnané s baseline auditu
- [ ] Celá brána zelená: test:unit, typecheck, lint, build, test:e2e:preview
