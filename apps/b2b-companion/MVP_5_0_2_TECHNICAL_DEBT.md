# MVP_5_0_2 Technical Debt

Tento soubor zachycuje veci, ktere jeste zbyva overit nebo uklidit pred tim, nez se MVP_5_0_2 bude brat jako hotove.

## Automaticke testy

Hotovo:

- [x] Unit/contract testy pro `buildStorefrontProjection` (B2B/B2C segmenty, hidden product/collection handles, quantity rules, variant visibility) — `tests/services/storefront-projection.server.test.ts`.
- [x] Contract test pro Liquid embed (`margin-guard-storefront-bootstrap`, `margin-guard-segment-default-hide`, `margin-guard-collection-default-hide`) — `tests/routes/visibility-script.contract.test.ts`.
- [x] Test, ze `app.settings` vola `syncStorefrontProjectionMetafields` po zmenach pravidel, ktere se do projekce promitaji — `tests/routes/visibility-script.contract.test.ts`.
- [x] Playwright product listing/carousel test: B2B/B2C produkt zmizi z `/collections/all` a neni nechan jako prazdny slot — `tests/e2e/storefront.listing.spec.ts`.
- [x] Playwright collection listing test: kolekce se schova pres projektovane inline CSS — `tests/e2e/storefront.listing.spec.ts`.
- [x] Playwright PDP/cart quantity test (projected minimum/step/max) — `tests/e2e/storefront.smoke.spec.ts`.
- [x] Playwright variant visibility test na product page — `tests/e2e/storefront.smoke.spec.ts`.

Zbyva:

- Spustit Playwright e2e proti zivemu dev shopu v CI (aktualne se bez bezici app instance + naseedovanych scenaru gracefully preskoci). Pridat dedikovany CI job.
- Zvazit ciste source-level "no-flash" mereni (prvni paint) nad ramec end-state assertions; mechanika je dnes kryta contract testy (`hideCardForHandle`/early-hide).

## Manualni overeni

- Overit, ze po ulozeni product visibility pravidla vznikne/aktualizuje se `shop.metafields.margin_guard.storefront_projection`.
- Overit, ze po ulozeni collection visibility pravidla se projekce aktualizuje.
- Overit, ze po ulozeni product quantity pravidla se projekce aktualizuje.
- Overit, ze po ulozeni variant visibility pravidla se projekce aktualizuje.
- Overit B2B segmentaci pres native `customer.b2b?`.
- Overit B2B segmentaci pres custom customer tag z global settings.
- Overit B2C anonymni navstevu bez prihlaseneho customer kontextu.

## Cleanup

- [x] Rozhodnuto: `app.settings` loader uz pri kazdem nacteni projection sync nespousti. Sync zustava po zmenach pravidel a catalog syncu (action handlery). Loader sync je gated za `storefrontProjection.syncOnSettingsLoad` (env `MARGIN_GUARD_PROJECTION_SYNC_ON_LOAD=1`), default vypnuto — viz `config/feature-flags.ts`.
- [x] Docasne `console.log(">>> SETTINGS LOADER...")` logy odstraneny.
- [x] Verbose storefront debug payloady (Liquid embed `embed bootstrap` / `early-hide cache applied`, visibility script `debugLog`) jsou gated. Server flag `MARGIN_GUARD_STOREFRONT_DEBUG=1` se promita do `projection.debug` + do generovaneho scriptu; per-session lze zapnout `?mg_debug=1` na storefront URL.
- [x] Liquid fallbacky pro prazdny `storefront_projection`: `buildStorefrontProjection` vraci pro prazdny config plne vyplneny payload (prazdne pole/objekty, nikdy null/undefined). Pokryto testem "produces a valid, fully-formed payload for an empty config".
- [x] Velikost metafieldu: `measureProjectionSize` + warning na 80 % a error nad 64 KB limitem v `syncStorefrontProjectionMetafields`. Chunkovani odlozeno (souvisi s vetsim katalogem / MVP_6).
- [x] `collectionQuantityRules` zustavaji `RUNTIME_ONLY` — pokryto testem invariantu.
- [x] Customer-specific pravidla (CUSTOMER_ONLY visibility, customer quantity rules) zustavaji mimo projection payload — pokryto testem invariantu.

## Poznamky k pristupu

Globalni metafield v tomto MVP nema nahrazovat runtime endpoint pro vsechno. Ma predpocitat jen pravidla, ktera jsou segmentove stabilni a daji se bezpecne pouzit uz pri prvnim renderu theme.
