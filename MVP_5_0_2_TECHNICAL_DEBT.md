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

- Rozhodnout, jestli ma `app.settings` loader pri kazdem nacteni settings spoustet async storefront projection sync, nebo jestli sync zustane jen po zmenach pravidel a catalog syncu.
- Odstranit nebo schovat za debug flag docasne `console.log(">>> SETTINGS LOADER...")` logy.
- Zkontrolovat verbose storefront debug payloady v Liquid embed a visibility scriptu.
- Zkontrolovat, ze Liquid fallbacky pro prazdny `storefront_projection` nevygeneruji nevalidni JSON.
- Zkontrolovat velikost metafieldu pri vetsim katalogu a rozhodnout, jestli bude potreba limitovani/chunkovani.
- Zkontrolovat, jestli collection quantity rules zustavaji spravne oznacene jako `RUNTIME_ONLY`.
- Zkontrolovat, jestli customer-specific pravidla zustavaji mimo projection payload.

## Poznamky k pristupu

Globalni metafield v tomto MVP nema nahrazovat runtime endpoint pro vsechno. Ma predpocitat jen pravidla, ktera jsou segmentove stabilni a daji se bezpecne pouzit uz pri prvnim renderu theme.
