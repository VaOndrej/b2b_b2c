# 04: Nastavení: náhled „Váš obchod“ ze skutečných hodnot

**What to build:** Ukázka v PageGuide na Nastavení ukazuje skutečný tarif, počet trhů a stav kombinování obchodu, ne hodnoty natvrdo v překladech. Obchod na Free nevidí „Tarif Pro“. Audit F1, porušení doktríny §5/§12.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Harness settings (Free) ukazuje v náhledu Free, settings?plan=pro ukazuje Pro
- [x] Počet trhů a stav kombinování odpovídají datům obrazovky
- [x] Unit test: náhled s plánem free neobsahuje Pro. Ze slovníku zmizí klíče s hodnotou natvrdo (cs i en)
- [x] Screenshot 390 + 1440

## Důkaz

- `app/components/model/page-guides.ts` `settingsGuideRows`: řádky „Váš obchod“ ze skutečných hodnot (kombinování nové slevy
  přes `combineSummary`, počet zapnutých trhů, tarif Free/Pro). Trhy nenačtené = řádek se nevykreslí, nic se nehádá.
- `PageGuide` má prop `facts`, `SettingsScreen` ho plní z `plan`, `markets` a `combineDefault`.
- Ze slovníku cs i en zmizely `guide.preview.setCombineValue`, `setMarketsValue`, `setPlanValue`.
- Testy `tests/ui/page-guide.test.ts`: model (Free bez „Pro“, Pro, bez trhů) + harness `settings` ukazuje Free, `settings?plan=pro` Pro;
  slovník bez vzorových hodnot.
- Brána: node 2043/2043, engine 720/720, typecheck 0, lint 0 chyb, E2E preview 48/48.
- Screenshoty: `docs/won-discounts/evidence/frontend-04/settings-free-{390,1440}.png`, `settings-pro-{390,1440}.png`, metrics.json.
