# 15: Pro jednou na sekci: editor slevy

**What to build:** V editoru slevy je v každé sekci nejvýš jedna zmínka o Pro: věta, co Pro přidá, a odkaz na tarif. Zamčené ovládací prvky Pro funkcí (zakázaný seznam Výjimek se všemi slevami, zakázané trhy) se na Free nevykreslují. Na Pro žádný zamčený prvek. Doktrína §18h, audit F4.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] rule-editor?rule=dev-f2-collection: v sekci Kombinace a trhy nejvýš jeden text „Pro“
- [x] &plan=pro: výjimky a trhy fungují, žádný zamčený prvek
- [x] Uložení na Free neposílá nic navíc oproti dnešku (skrytá pole beze změny)
- [x] Screenshot 390 + 1440 Free i Pro

## Důkaz

- `rule-editor/ProSection.tsx`: na Free sekce Kombinace a trhy = Sčítá se s (pro všechny tarify) + jedna Pro poznámka
  (`ProSell`, věta `editor.pro.sell` „S Pro povolíte sčítání s jednou konkrétní slevou… a pustíte slevu jen do vybraných trhů.“
  + odkaz na tarif). Zamčený rám, vypnutý seznam Výjimek se všemi slevami, vypnuté trhy a štítek „Pro · odemknout“ se na
  Free nekreslí. Uložená Pro nastavení na Free dál říkají, že neplatí, a jdou odebrat (`dropMarkets`, `dropSegments`).
  Odkaz `#markets` na Free přistane u Pro poznámky.
- Pro: výjimky a trhy fungují, žádný zamčený prvek, jeden štítek Pro u trhů.
- Uložení na Free posílá stejná pole: zamčené prvky byly `disabled`, takže se neposílaly ani dřív. E2E kontroluje, že
  FormData editoru na Free nemá `markets` ani `combineRules`.
- Ve „Pro“ textu na Free: poznámka obsahuje „S Pro …“ a odkaz „Zobrazit tarif Pro“ (jedna poznámka, ne čtyři jako dřív).
- Testy: `tiles.test.ts` (Free: 0 štítků, 1 poznámka, žádný zamčený seznam; Pro: 1 štítek, nic zamčeno),
  `admin.views.spec.ts` (Free/Pro v prohlížeči). `admin.navigation.spec.ts`: skok na „Kdy platí“ přijme i dorolovanou
  stránku (stránka pod sekcí zkrátila).
- Brána: node 2052/2052, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 63/63.
- Screenshoty `docs/won-discounts/evidence/frontend-15/`: `pro-section-{free,pro}-{390,1440}.png`, celé `rule-edit*`, `rule-new`.
