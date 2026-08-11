# Won Stepper — MVP žebřík (formalizace)

> 2026-08-10. Stepper byl v roadmapě „ready-to-build" (brainstorm + theme-attachment
> de-risk uzavřeny), ale žebřík nebyl očíslovaný — tohle je ta formalizace.
> Kanonická karta: `docs/product-roadmap.html` (Won Stepper). Souvislosti:
> paměť `won-cart-suite-souls-limits`, dřívější `docs/plans/2026-08-01-won-quantity-standalone-app.md`
> (Won Quantity se vlil do Stepperu → quantity rules = Stepper Pro).

## Duše & pozicování (shrnutí)

„Změň to snadno." Pure-surface optimistický +/− qty widget: jediné zápisy do košíku
jsou user-initiated, žádná Function, žádná manipulace cen. Rychlý, spolehlivý, s
`safe no-op` (když si není jistý attachmentem, radši nenakreslí nic). Flat $2/mo,
genuinely modular (jen stepper) — proti usage-metered konkurenci.

## Hranice ploch (z de-risk sweepu 8 témat — určuje scope MVP)

| Plocha | Obtížnost | Přístup |
|---|---|---|
| **Cart page + drawer** | 🟢 snadné | Auto-attach (`updates[]` 7/8, `/cart/change.js` outlier; drawer 6/8, cart-page fallback). **Domov Stepperu.** |
| **PDP** | 🟡 app block | 7/8 témat na PDP stepper nemá → merchant **app block**, ne auto-detekce; pre-add qty input. |
| **Search / cross-sell modal** | 🔴 best-effort | Dynamicky injektováno, často cizí appka / iframe → heuristika + `safe no-op`, nikdy slib. |

## Reuse (velký) vs nové

- **Reuse:** `@won/core/cart` (`cartState` reaktivní snapshot `/cart.js`, `cartAdapter`
  wrap `/cart/(add|change|update|clear).js`, milestone state machine — zděděno z Toasts pilota);
  vlastní quantity engine v `@won/core` (Won Quantity scaffold); sdílený
  `<won-host>` design tokeny; cross-app bus `document` event `won:cart:update`.
- **Nové (2 rizikové kusy):** `optimistic.mutate(op)` (okamžitý next-state → reálný
  `/cart/*.js` → reconcile z `/cart.js` → rollback při chybě/timeoutu; idempotence
  proti dvojkliku; re-sync mezi taby; ignoruje `_gift_progress`) a **theme-attachment**
  (adapter registry + heuristika + safe no-op).

## MVP žebřík (každý shippable, TDD červená-první)

- **MVP0 — skeleton.** Klon `_template`, napojení `@won/core/cart` + quantity engine,
  shop-scoped config, app embed injektne `<won-host>` no-op, E2E workspace.
- **MVP1 — cart + drawer optimistic stepper (DUŠE, shippable).** Auto-attach na
  univerzální ploše (de-risknuto). `optimistic.mutate` red-first (okamžité UI,
  agregovaný sync, rollback na server-pravdu, idempotence, multi-tab). Živý count.
  `safe no-op`. Toggle „neotvírat boční košík při quick add/remove" (default neotvírat).
- **MVP2 — PDP app block.** Merchant položí stepper na PDP (schopnost, kterou 7/8
  témat nemá); pre-add qty input; varianta-na-kartě (default / mini-picker).
- **MVP3 — robustnost + širší plochy.** Theme-adapter registry (top témata = precizní
  selektory; `theme-sweep.mjs` = jeden řádek na téma) + heuristika OS2.0 konvencí;
  síťová odolnost (queue/retry/reconcile na flaky mobilu); flush na `pagehide`/
  `visibilitychange`; lazy-mount na gridech (IntersectionObserver); best-effort
  search/collection-card attach s `safe no-op`. Reconcile = autorita (`/cart.js` vyhrává).
- **MVP4 — Pro: quantity rules.** MOQ / násobky / max z metafieldu `won.quantity_rules`
  (snap na násobky, disable na maxu, hint „min N"); přímé zadání čísla na cart page;
  volitelná **Cart Validation Function** jako tvrdé vynucení u checkoutu (Stepper Pro
  hardening — ne samostatná appka); segment/collection cílení; appearance tuning + custom CSS.
- **MVP5 — analytika, cross-app, billing.** Analytika vede k závěrům (kde se mění
  množství = kam dát pozornost; up/down/qty→0 = friction diagnóza; produkty bumpnuté
  na 2–3+ → krmí Companion bigger-pack a Rewards prahy; velká množství → insight pro
  Tiers). Cross-app awareness karta „Nejlépe funguje s Won Toasts" (install status +
  odkaz; varovat když drawer-auto-open vypnutý a Toasts není). Shopify Billing, Pro gate.

## Free / Pro

- **Free:** steppery všude (cart/drawer/PDP-block) + živý count + inventory cap +
  a11y/klávesnice + safe no-op.
- **Pro:** quantity rules (MOQ/násobky/max) + Cart Validation hard-enforce +
  segment/collection cílení + appearance tuning + custom CSS.

## Pre-build spike (patří do build fáze, ne plánování)

- `optimistic.mutate` red-first unit testy (idempotence, rollback, multi-tab reconcile).
- Theme-adapter detekce napříč top tématy (`theme-sweep.mjs` už existuje jako půl-de-risk).

## Gate

`test:unit`, `typecheck`, `build -w won-stepper`, `test:e2e` (Horizon+Dawn),
`validate:shopify`.
