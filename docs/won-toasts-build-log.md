# Won Toasts — build log (autonomní běh)

Checkpointy, rozhodnutí a parkované otázky z autonomní stavby. Kanonický plán:
[`won-toasts-mvp-plan.md`](won-toasts-mvp-plan.md).

## Rozhodnutí (jedu s nimi, doladíme ráno)

- **Git:** větev `won-toasts`, lokální commit po každém MVP jako checkpoint.
  Nepushuji bez pokynu.
- **Billing:** Free / $5/mo USD, 7denní trial. Detaily před releasem (MVP5).
- **GiftLadder integrace:** napojení jen na konvenci `_gift_progress` na cart
  řádku (nevyžaduje existenci GiftLadder appky). Test přes seedovaný cart.
- **E2E na živém storefrontu:** `shopify app dev` běží, ale theme app extension
  není aktivní → storefront E2E se teď neodběhne živě. Píšu E2E **spec-driven**
  (dle specu, ne dle implementace) a nechávám jako *pending live storefront*.
- **Vynutitelný gate každého MVP:** `test:unit -w won-toasts && typecheck -w
  won-toasts && build -w won-toasts && validate:shopify` + `test:packages`
  (core engine). E2E = authored, spouští se až bude embed aktivní.
- **Testovací filozofie:** testy píšu podle **specu** (plán + defaulty configu),
  ne podle implementace → chrání proti regresím při dalších MVP.

## Parkované otázky (na ráno)

- Billing: trial délka a přesná cena/měna finálně? (jedu 7 dní / $5 USD)
- Free „až 3 aktivní recepty" — potvrdit strop.
- Přesná sada scopes (zatím `read_products`; storefront cart čte přes Ajax API
  bez extra scope; billing přidá `read_own_subscription_contracts`? ověřit).

## Známé / parkované technické položky

- **Aggregate `validate:shopify` je červený kvůli won-quantity** (throwaway):
  `won-quantity.js` má 16 722 B > 10 000 B threshold `AssetSizeAppBlockJavaScript`.
  Pre-existing, netýká se won-toasts. **Gate pro won-toasts = theme check pouze
  jeho extensionu** (`shopify theme check --path
  apps/won-toasts/extensions/won-toasts-storefront`) → **0 offenses**. Won-toasts
  JS je 2 929 B (pod BFS 15 kB i pod 10 kB app-block threshold).

## Checkpointy

### MVP0 — Skeleton ✅ (badge → Scaffold)
Klon `_template` → `apps/won-toasts`, `ToastAppConfig` model + 2 migrace
(Session + init_toast_config), app-proxy `won-toasts.config` + `won-toasts.health`
(marker `won-toasts-config-ok`), theme app extension app embed s no-op
`<won-toast-host>` (Shadow DOM + `data-won-toasts-region` + `aria-live`),
`data-won-toasts-status="ready"`, Polaris Overview s `enabled` togglem + install
check, uninstall webhook čistí data (GDPR). Core `@won/core/toasts` config engine
(defaults + `resolveToastConfig`, jediný zdroj pravdy).

**Testy (spec-driven, ne dle implementace):**
- `@won/core` toasts config: 6 nových testů (defaulty specu, deep-merge, safety) — pass.
- won-toasts `test:unit`: contract (embed = čistý surface, žádná cart mutace,
  app-proxy autentizace) + service (default config, izolace shopů, merge, cleanup)
  — 9 pass.
- E2E `storefront.toasts.spec.ts` (Dawn+Horizon): host mount + `ready` + shadow
  region + žádná cart mutace. **Authored, pending live embed** (embed není aktivní).

**Gate:** `test:packages` ✓ · `test:unit -w won-toasts` ✓ · `typecheck` ✓ ·
`build` ✓ · theme check won-toasts ✓ · lint ✓.

Commit: `won-toasts MVP0 skeleton`.
