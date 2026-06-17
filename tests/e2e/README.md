## Shopify Storefront E2E

Tyto testy jsou tenke Playwright smoke testy nad realnym storefrontem.

### Co chrani

- naceteni `Margin Guard` theme app embedu na skutecne PDP
- visibility banner a blokaci add-to-cart pro skryty produkt
- MOQ a step notice na PDP a normalizaci `quantity` inputu
- variant visibility banner pro B2B-only variantu
- max order quantity notice + acknowledgment ("I understand") tlacitko
- `storefront.listing.spec.ts`: B2B-only produkt zmizi z product listingu (`/collections/all`) a neni nechan jako prazdny slot v carouselu/gridu
- `storefront.listing.spec.ts`: B2B-only kolekce se schova z collection listingu (`/collections`) pres projektovane inline CSS

### Jak je spustit

1. V samostatnem terminalu mejte pripravenou app instanci, na kterou shop ukazuje.
   - typicky `npm run dev`
2. Nastavte envy:
   - `SHOPIFY_E2E_STOREFRONT_BASE_URL=https://b2b-b2c-store-development.myshopify.com`
     - nebo lokalni `shopify theme dev` origin, napr. `http://127.0.0.1:9292`
   - pri lokalnim theme dev navic `SHOPIFY_E2E_SHOP_DOMAIN=b2b-b2c-store-development.myshopify.com` (Admin API handle lookup musi mirit na realny shop, protoze localhost origin nesedi s offline session shopem)
   - volitelne `SHOPIFY_E2E_STOREFRONT_PASSWORD=...`, pokud je storefront zamceny password page
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY=...`
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_STEP=...`
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_MAX=...`
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT=...`
   - volitelne `SHOPIFY_E2E_COLLECTION_HANDLE=...` (collection listing scenario)
3. Jednou nainstalujte browser:
   - `npx playwright install chromium`
4. Spustte:
   - `npm run test:e2e:storefront`
   - nebo `npm run guard:test`

### Known-good scenario pro development store

Theme na `b2b-b2c-store-development` nema na PDP quantity input a `/collections` neukazuje
vsechny kolekce jako karty, takze cast scenaru se preskoci (viz nize). Overene handly pro
spusteni proti tomuto storu (`npm run dev` musi bezet):

```
SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY=the-complete-snowboard
SHOPIFY_E2E_PRODUCT_HANDLE_STEP=the-inventory-not-tracked-snowboard
SHOPIFY_E2E_PRODUCT_HANDLE_MAX=the-inventory-not-tracked-snowboard
SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT=the-complete-snowboard
SHOPIFY_E2E_COLLECTION_HANDLE=automated-collection
```

Aktualni vysledek proti tomuto storu: **4 passed / 3 skipped / 0 failed**.
Passed: PDP visibility hide, product listing hide, variant visibility, max-quantity notice.
Skipped (environmentalni, ne bug):
- MOQ/step input + acknowledgment: theme nema viditelny PDP quantity input (MOQ/step notice se ale renderuje a je asertovan).
- collection listing: cerstve synchronizovany `storefront_projection` metafield se hned neprojevi v renderu (Shopify edge cache). Logika je kryta projection unit + embed contract testy.

### Co zatim NENI pokryte (storefront E2E)

- **Realny B2B login** (skutecne prihlaseni B2B zakaznika v prohlizeci). B2B EFEKTY se renderuji pres gated override `mg_e2e_segment` (matice tema × segment, viz nize); B2B TRIGGER + realne app-proxy customer plumbing (`logged_in_customer_id` → tagy) jsou na integracnim tieru.
- **Checkout-level enforcement** (discount cap / margin floor pres Shopify Functions). Kryto vitest + contract/runtime testy + serialni `storefront.cart-enforcement.spec.ts`, ne plnym prohlizecem.

### Poznamky

- `guard:test` tyto smoke testy vola automaticky.
- Handly se primarne resi automaticky:
- `visibility` z posledniho restriktivniho `ProductVisibilityRule`
- `step` z posledniho `ProductQuantityRule`, ktery ma `stepQuantity > 1`
- `max` z posledniho `ProductQuantityRule`, ktery ma `maxOrderQuantity > 0`
- `variant` z posledniho restriktivniho `ProductVariantVisibilityRule`
- `collection` z posledniho restriktivniho `CollectionVisibilityRule` (handle ulozeny primo v pravidle)
- K prekladu `productId -> handle` se pouzije offline Shopify session ulozena v Prisma.
- `SHOPIFY_E2E_PRODUCT_HANDLE_*` slouzi jen jako rucni override, kdyz chcete konkretni produkt vynutit.
- Kazdy `SHOPIFY_E2E_PRODUCT_HANDLE_*` je slug z URL produktu.
- Priklad: z URL `https://.../products/my-test-product` je handle `my-test-product`.
- Produkt musi byt publikovany na online store a jeho PDP musi obsahovat standardni `form[action*='/cart/add']`.
- Kdyz auto-resolved variant handle neprojde storefront preflightem, runtime zkusí fallback `the-complete-snowboard`.
- Collection listing scenario pracuje s `shop.metafields.margin_guard.storefront_projection` (runtime app-proxy payload kolekce nenese). Seed proto pres ulozenou offline session zapise projection metafield na ZIVY dev shop a `afterAll` ho po obnoveni DB snapshotu zase preprojektuje. Bez offline session se collection test preskoci.

---

## Paralelni dual-theme matrix suite (`playwright.matrix.config.ts`)

Vedle **serialni** suity (mutuje config per-test, `workers: 1`) existuje **paralelni read-only matrix suita**, ktera bezi proti OBEMA tematum.

1. `globalSetup` (`matrix.setup.ts`) jednou postavi matici (`support/matrix.ts`) a zapise `.matrix.json`. Dva rezimy:
   - **manifest rezim** (kdyz existuje `.matrix.json` zdroj `.manifest.json` ze seederu): seeder uz naseedoval pravidla ADITIVNE → globalSetup neresetuje, jen synchronizuje projekci. Stav PRETRVA.
   - **legacy rezim** (bez manifestu): zachyti `.matrix-snapshot.json`, postavi archetypy z `CatalogProduct/Collection/Variant`, naseeduje vse najednou (kazdy archetyp na jiny produkt) a synchronizuje. `globalTeardown` (`matrix.teardown.ts`) obnovi snapshot.
2. `storefront.matrix.spec.ts` cte `.matrix.json` a generuje **jeden test na fixture** — read-only → `fullyParallel`, bez race o sdileny config/metafield.
3. **Matice tema × segment** = ctyri projekty se stejnymi specy; tema i segment se injektuji pres `theme`/`segment` project options a `themeContext` fixture (`support/theme.ts`, `support/fixtures.ts`):
   - `tier1-horizon-b2c` / `tier1-dawn-b2c`: `mg_e2e_segment=B2C`.
   - `tier1-horizon-b2b` / `tier1-dawn-b2b`: `mg_e2e_segment=B2B`, oba maji `dependencies` na oba B2C projekty → **vsechny B2C (Horizon+Dawn) dobehnou pred B2B**.
   - `*-horizon-*`: live (publikovane) tema, bez preview paramu.
   - `*-dawn-*`: nepublikovany Dawn pres `?preview_theme_id=<SHOPIFY_E2E_PREVIEW_THEME_ID>` ke KAZDE navigaci (prezije i `maybeUnlockStorefront`). Bez te env se Dawn projekty **skipnou**.
   - Segment jede na PAGE URL jako `?mg_e2e_segment=` (vedle `preview_theme_id`); app-proxy ho promitne na vynuceny segment jen kdyz je armed runner-owned flag `MARGIN_GUARD_E2E_OVERRIDE=1` (viz nize). B2B specy asertuji B2B hodnoty, B2C specy B2C.
   - **DOM hiding** (product visibility banner/karta + collection karty) renderuje server-side **Liquid vrstva** (`segment-default-hide` CSS + projection bootstrap) z REALNEHO (anonymniho→B2C) zakaznika, takze ji `mg_e2e_segment` **nevynuti** — v produkci obe vrstvy vzdy reflektuji stejneho zakaznika, konflikt vznika jen pri forced override. Pod B2B projektem se proto product visibility asertuje na urovni **`/visibility` payloadu** (vrstva, kterou override RIDI) a DOM banner/karta + collection asserce se asertuji jen na B2C. DOM hiding pro prihlaseneho B2B je zbytkovy gap (kryto integracnim tierem + projection/embed contract testy).

Selektory tematu (PDP form / quantity input / add-to-cart / product+collection karta) jsou v `support/theme.ts` per-tema; app-injected markery (`#margin-guard-*`) jsou theme-independent. Po prvni navigaci se overuje aktivni tema pres `window.Shopify.theme` — pri mismatchi test **HLASITE selze** (netestuje se spatne tema).

Spusteni: `npm run test:e2e` pusti VSECHNO jednim prikazem — matici (B2C → B2B) a pak serialni shop-level tier. Flag `MARGIN_GUARD_E2E_OVERRIDE=1` vlastni runner (`scripts/run-playwright-e2e.mjs` + `playwright.matrix.config.ts` `webServer.env`), **NE `.env`/git**: injektuje se jen pro matici, serialni tier bezi bez nej, a runner tvrde odmitne flag ulozeny v `.env`. (`npm run test:e2e:matrix` / `npm run test:e2e:storefront` zustavaji pro spusteni jen jedne casti.)

Volitelne env pro overeni jmena tematu: `SHOPIFY_E2E_HORIZON_THEME_NAME`, `SHOPIFY_E2E_DAWN_THEME_NAME`.

### Komplexni seed (`npm run e2e:seed-catalog`)

`scripts/seed-e2e-catalog.mts` je **idempotentni, aditivni** provisioner (zadny reset). Zalozi pres Admin API publikovane `mg-e2e-*` produkty/kolekce (`write_products`) a naseeduje VSECHNY child-tabulky MarginGuardConfig — kazdy rule-set na vlastni dedikovany produkt/kolekci (aby se storefront resolution neprekryval). Enum hodnoty (visibilityMode, stackMode, scope, action, targetType, targetPosition, pageType, segment, …) se NEHADAJI — taha je pres `Parameters<typeof upsert…>` z realnych signatur + compile-time completeness guard. Vystup: `.manifest.json` (produkt/kolekce/rule → scenar), ktery konzumuje matrix builder. Prerekvizity: offline session + `write_products`/`write_discounts` (uz granted). Spousti `prisma:ensure-db`, takze seeduje do spravne DB.

## B2B vetev — EFEKTY pres override, TRIGGER integracne (NE prohlizec)

Dev store je na NOVYCH (passwordless) zakaznickych uctech, takze realny B2B login do prohlizece nejde zautomatizovat. B2B se proto pokryva ve dvou rovinach:

- **EFEKTY** (visibility / varianty / quantity) se renderuji na storefrontu pres **gated per-request override** `mg_e2e_segment` — Tier-1 matice bezi jako tema × segment (B2B projekty vyse). Override sdili jedna centralni gate (`app/services/storefront-segment-override.server.ts`), kterou ctou OBA storefront proxy entrypointy: `resolveSegmentForStorefront` (storefront-content) i `/visibility` loader (kde se resolvuji prave hidden handles / varianty / quantity). Povolene hodnoty se taha z realneho `Segment` enumu (`isSegment`), ne hadaji.
- **TRIGGER** (zakaznik s tagem `b2b` → segment) je pokryt **integracne**: cisty engine (`tests/segment/segment-detection.test.ts`) + `tests/visibility/margin-guard-visibility.loader.test.ts`, ktery vola app-proxy visibility loader s nasimulovanym kontextem (admin tag lookup vrati `b2b`) a asertuje aplikaci B2B pravidel pres REALNE resolvery + protipripad pro anonymniho B2C.

**Zbytkovy gap:** override zamerne obchazi realne app-proxy customer plumbing (`logged_in_customer_id` → fetch tagu pres Admin API) a nese jen segment, ne `customerId` — to pokryva integracni test triggeru. `write_customers` scope NENI potreba. Override je tvrde vypnuty v produkcnim buildu (`NODE_ENV === "production"` → no-op) a bez runner-owned flagu nema `mg_e2e_segment` zadny efekt (viz `tests/segment/storefront-segment-override.test.ts`).

## Cart-level enforcement smoke (`storefront.cart-enforcement.spec.ts`)

Serialni Tier-3 smoke: aktivuje discount/cart-validation Funkce pres offline session, prida produkt do kosiku a overi (a) ze discount funkce nepustí cenu pod 70% floor, (b) ze cart validation blokuje checkout pod MOQ. Bez aktivnich Funkci / automaticke slevy se gracefully preskoci. Vycerpavajici matice slev/marginu zustava na vitest/contract.

Volitelny override produktu: `SHOPIFY_E2E_PRODUCT_HANDLE_CART`.
