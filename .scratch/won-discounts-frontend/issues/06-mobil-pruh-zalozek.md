# 06: Mobil: pruh záložek pod Slevy

**What to build:** Na 390 px je v pruhu šesti záložek pod Slevy vždy celá vidět aktivní záložka a je poznat, že vedle jsou další (Výprodej, Kampaně, Umístění). Dnes jsou za okrajem bez náznaku. Hlavička „Vaše slevy“ se na mobilu nedotýká okraje (počet pozornosti pod nadpis). Desktop beze změny. Audit F8.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Na všech 6 stránkách pod Slevy je na 390 px aktivní záložka celá v pohledu (Playwright měří rect)
- [x] Je vidět náznak dalších položek a všechny jdou dosáhnout dotykem i klávesnicí
- [x] Vodorovný přetok stránky zůstává 0
- [x] Screenshoty 390 všech 6 stránek + 1440 jedné

## Důkaz

- `shell/SubNav.tsx`: okraj pruhu, za kterým jsou další záložky, jemně mizí (CSS maska, žádná vlastní barva), stav okrajů
  čte `stripMore` při posunu a změně šířky (`data-won-subnav-more="left right"`). Aktivní záložka se posune do pohledu
  s odstupem od přechodu, `scroll-padding-inline` dělá totéž pro fokus z klávesnice. Desktop: všech šest záložek se vejde,
  žádný přechod, vzhled beze změny (`discounts-1440.png`).
- Unit `tests/ui/nav.test.ts` (stripMore). E2E `admin.navigation.spec.ts` „the strip under 'Slevy' on a phone…“: na všech 6
  stránkách je aktivní záložka celá v pruhu, pruh hlásí náznak, přetok 0; z první stránky se poslední záložka dosáhne posunem
  i tabulátorem a Enter na ni přejde.
- Hlavička „Vaše slevy“ se na 390 px dotýká okraje kvůli červenému počtu vpravo. Ten počet celý odstraňuje ticket 13
  (počet jen v záložce), proto se tady neposouvá pod nadpis.
- Brána: node 2044/2044, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 50/50.
- Screenshoty: `docs/won-discounts/evidence/frontend-06/strip-{discounts,tiers,rewards,outlet,campaigns,placements}-390.png`, `discounts-1440.png`.
