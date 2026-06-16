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

### Co zatim NENI pokryte

- **B2B prihlaseny zakaznik** (jine ceny / produkty / obsah pro B2B). Harness testuje jen anonymniho (B2C) navstevnika. Pro B2B by bylo potreba B2B test customer + prihlasovaci automatizace.
- **Checkout-level enforcement** (discount cap / margin floor pres Shopify Functions). Kryto vitest + contract/runtime testy, ne prohlizecem.

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
