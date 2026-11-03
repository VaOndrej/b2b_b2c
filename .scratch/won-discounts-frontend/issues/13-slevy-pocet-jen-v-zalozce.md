# 13: Slevy a kódy: počet pozornosti jen v záložce

**What to build:** Na Slevách a kódech je počet slev vyžadujících pozornost jen v záložce „Vyžaduje pozornost N“. Červená věta v hlavičce „Vaše slevy“ zmizí. Důvod zůstává jako věta v řádku slevy. Audit F2.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] discounts?sync=ok: text „vyžadují pozornost“ mimo záložku a řádky není
- [x] Záložky, hledání, filtr a řazení fungují jako dřív (existující testy zelené)
- [x] Screenshot 390 + 1440

## Důkaz

- `DiscountsScreen.tsx`: červená věta „3 slevy vyžadují pozornost“ v hlavičce „Vaše slevy“ pryč, počet je jen v záložce
  „Vyžaduje pozornost 3“, důvod zůstává větou v řádku. Nepoužívané klíče `discounts.table.attention.*` smazané (cs, en).
  Tím se i na 390 px hlavička přestala dotýkat okraje (zbytek ticketu 06).
- E2E `admin.state-once.spec.ts` „Slevy a kódy: how many need attention is said once, on the tab“ (1440 i 390): záložka má 3,
  mimo záložku a řádky text „vyžaduje/vyžadují pozornost“ není, přetok 0. Záložky, hledání, filtr a řazení hlídají
  existující testy (`rule-table.test.ts`, E2E), všechny zelené.
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 61/61.
- Screenshoty `docs/won-discounts/evidence/frontend-13/discounts-{390,1440}.png`, `discounts-empty-*`.
