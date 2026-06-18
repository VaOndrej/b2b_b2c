## Shopify Storefront E2E (catalog-native)

Tenke Playwright smoke testy nad realnym storefrontem. Od **MVP_5_4** je harness
plne **catalog-native**: zadny segmentovy shim, zadne manufakturovani produktu.

### Klicovy model: dedikovany e2e katalog + gated override

Vsechna e2e pravidla ziji na JEDNOM dedikovanem, odhoditelnem cenovem katalogu
(`support/catalog-e2e.ts`, audience tag `mg-e2e-catalog`), ktery se resolvne JEN
pres gated per-request override `mg_e2e_audience`. Zadny realny zakaznik ten tag
nenese, takze realni navstevnici dal padaji do `default`/`b2b` — **uzivateluv
zivy config se nikdy nedotkne**. Uklid = smazani katalogu (`deletePriceCatalog`,
cascade), nulovy blast radius. Pravidla se seeduji na EXISTUJICI publikovane
produkty (zadne zakladani produktu → zadne `read_publications`/`write_publications`).

Override sdili jedna centralni gate
(`app/services/storefront-catalog-override.server.ts`), kterou ctou oba storefront
proxy entrypointy: `/visibility` loader (hidden handles / varianty / quantity /
discount-conflicts) i `resolveSegmentForStorefront` (storefront-content). Gate je
tvrde vypnuta v produkci (`NODE_ENV === "production"` → no-op) a bez runner-owned
flagu `MARGIN_GUARD_E2E_OVERRIDE=1` nema `mg_e2e_audience` zadny efekt (viz
`tests/segment/storefront-catalog-override.test.ts`).

### Dve vrstvy

1. **Paralelni read-only matice** (`playwright.matrix.config.ts`,
   `storefront.matrix.spec.ts`) — tema × KONTEXT:
   - `base` (zadny override → default katalog → produkt viditelny/neomezeny)
   - `catalog` (`mg_e2e_audience=mg-e2e-catalog` → seeded restriktivni pravidlo plati)

   `globalSetup` (`matrix.setup.ts`) jednou zalozi e2e katalog, postavi matici z
   `CatalogProduct/Variant` (`support/matrix.ts`) a naseeduje kazdy archetyp
   (`HIDDEN`, `VARIANT_HIDDEN`, `QUANTITY_MOQ_STEP`, `QUANTITY_MAX`) na vlastni
   produkt. `globalTeardown` katalog smaze. Vse read-only → `fullyParallel`, bez
   inter-project dependency. Ctyri projekty: `tier1-{horizon,dawn}-{base,catalog}`;
   Dawn pres `?preview_theme_id=<SHOPIFY_E2E_PREVIEW_THEME_ID>` (bez te env se
   skipne). Asertuje se **`/visibility` payload** (vrstva, kterou override RIDI).

2. **Serialni mutate-per-test tier** (`playwright.config.ts`) — DOM efekty, ktere
   matice neasertuje: `storefront.smoke.spec.ts` (visibility banner, MOQ/step
   notice + input, variant banner, cart max notice + acknowledgment),
   `storefront.listing.spec.ts` (odebrani karty z listingu),
   `storefront.discount-conflict.spec.ts` (cart conflict banner). Kazdy test
   dostane CERSTVY e2e katalog (`setupE2ECatalog`), naseeduje si jen sve pravidlo a
   naviguje s `mg_e2e_audience` (forced katalog). I tento tier tedy bezi s armed
   flagem.

### Jak spustit

1. App instance, na kterou shop ukazuje (`npm run dev`). Pro forced katalog musi
   app bezet s `MARGIN_GUARD_E2E_OVERRIDE=1` (runner ji nastartuje s flagem pres
   `webServer`, nebo si dev server pust s flagem sam).
2. Envy:
   - `SHOPIFY_E2E_STOREFRONT_BASE_URL=https://b2b-b2c-store-development.myshopify.com`
   - volitelne `SHOPIFY_E2E_STOREFRONT_PASSWORD=...` (zamceny storefront)
   - volitelne `SHOPIFY_E2E_PREVIEW_THEME_ID=...` (Dawn projekty)
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_{VISIBILITY,STEP,MAX,VARIANT}=...` (rucni override)
3. `npx playwright install chromium` (jednou).
4. `npm run test:e2e` (matice + serialni tier) — flag `MARGIN_GUARD_E2E_OVERRIDE=1`
   vlastni runner (`scripts/run-playwright-e2e.mjs`), **NE `.env`/git** (runner flag
   v `.env` tvrde odmitne). `npm run test:e2e:matrix` / `npm run test:e2e:storefront`
   spusti jen jednu cast.

Handly se resi automaticky ze seedovaneho `.matrix.json` (preferovane, zaruceny
publikovany produkt) → DB auto-resoluce → `SHOPIFY_E2E_PRODUCT_HANDLE_*` override.
`productId → handle` preklad jde pres offline Shopify session v Prisma.

### Co NENI pokryte (zbytkove gapy, dokumentovane)

- **Collection visibility** se renderuje server-side z `storefront_projection`
  metafieldu (Liquid), klicovano segmentem b2b/b2c — override ji do custom katalogu
  nevynuti. Kryto projection unit + embed contract testy.
- **Realny checkout-level enforcement** (Shopify Functions: discount cap / cart
  validation block) — kryto integration/contract/runtime testy (cart-validation-*,
  discount-function-enforcement, …), ne plnym prohlizecem. Per rozhodnuti MVP_5_4
  bezi storefront e2e jen na app-proxy vrstve.
- **Realny tagovany login** (skutecne prihlaseni zakaznika) — TRIGGER (tag →
  katalog) je na integracnim tieru (`tests/visibility/margin-guard-visibility.loader.test.ts`).
