# Vrstva 3 — globální matice, oblast Effects

Měřeno na homepage 1440 px: klidový stav → `hover()` → `mouse.down()`, čtené
`transform`, `background-color`, `color`, `border-color`, `box-shadow`,
`transition-duration` a animace na `::after`. Harness: `tmp/fx-matrix.mjs`.

## won_btn_hover

| hodnota | co se změní při hoveru | verdikt |
|---|---|---|
| `none` | nic (jen sheen, což je jiné nastavení) | **OK** |
| `lift` | `transform: matrix(1,0,0,1,0,-2)` + `box-shadow` | **OK** |
| `grow` | `transform: matrix(1.04,0,0,1.04,0,0)` | **OK** |
| `fill` | `background-color` → tmavší akcent (`oklab(...)`) | **OK** |
| `outline` | `bg` → průhledná, `color` → akcent, `border` → akcent | **OK** |

Pět hodnot, pět vizuálně odlišných výsledků. Žádné mrtvé nastavení.

## won_btn_sheen

| hodnota | animace na `::after` | verdikt |
|---|---|---|
| `off` | v klidu ani při hoveru nic | **OK** |
| `hover` | v klidu nic, při hoveru `won-sheen` / 0,75 s / 1× | **OK** |
| `loop` | už v klidu `won-sheen` / 0,75 s / **infinite** | **OK** |

## won_btn_press

| hodnota | při `mouse.down()` | verdikt |
|---|---|---|
| `none` | `transform` se nemění (ověřeno zvlášť: hover i press = `matrix(1,0,0,1,0,-2)`) | **OK** |
| `sink` | `transform` → `matrix(0.97,0,0,0.97,0,0)` | **OK** |

Press je nezávislý na hoveru — při `hover=none` sink pořád funguje.

## won_fx_speed

| hodnota | `transition-duration` | délka sheenu | verdikt |
|---|---|---|---|
| `fast` | 0,12 s | 0,48 s | **OK** |
| `normal` | 0,24 s | 0,75 s | **OK** |
| `slow` | 0,42 s | 1,20 s | **OK** |

Dvě nezávislé proměnné (`--won-fx-dur`, `--won-fx-sheen-dur`) reagují obě.

## Verdikt oblasti

**Žádný nález.** 13 hodnot ve 4 rodinách, každá měřitelně odlišná, žádné mrtvé nastavení,
žádný drift. `prefers-reduced-motion` a strukturu efektové vrstvy už hlídá
`tests/smoke/won-cta-effects.spec.ts`, takže se sem nepřidával nový guard.

## Dvě chyby v měření, ne v motivu

1. **První průchod četl `translate`/`scale` a `::before`.** Efektová vrstva používá
   `transform` a `::after`, takže `lift`, `grow`, `press` i celý sheen vyšly jako
   „žádná změna". Vypadalo to na tři mrtvá nastavení; po opravě sondy je vše v pořádku.
   **Poučení: než ohlásíš mrtvé nastavení, přečti si, kterou vlastnost jeho CSS opravdu
   mění — sonda musí měřit tu, ne tu, kterou bys čekal.**
2. **`won_btn_press = none` jednou vrátilo „žádné CTA s efektovou vrstvou".** Přímé
   ověření našlo 44 CTA s `won-fx--press-none`. Byl to výpadek `theme dev` proxy během
   resyncu — potřetí v téhle session. Katalogové/plošné skeny přes :9292 dělat s retry
   a podezřelý výsledek vždy potvrdit druhým měřením.
