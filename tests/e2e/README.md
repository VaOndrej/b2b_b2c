## Shopify Storefront E2E

Tyto testy jsou tenke Playwright smoke testy nad realnym storefrontem.

### Co chrani

- naceteni `Margin Guard` theme app embedu na skutecne PDP
- visibility banner a blokaci add-to-cart pro skryty produkt
- MOQ a step notice na PDP a normalizaci `quantity` inputu

### Jak je spustit

1. V samostatnem terminalu mejte pripravenou app instanci, na kterou shop ukazuje.
   - typicky `npm run dev`
2. Nastavte envy:
   - `SHOPIFY_E2E_STOREFRONT_BASE_URL=https://b2b-b2c-store-development.myshopify.com`
   - volitelne `SHOPIFY_E2E_STOREFRONT_PASSWORD=...`, pokud je storefront zamceny password page
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY=...`
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_QUANTITY=...`
   - volitelne `SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT=...`
3. Jednou nainstalujte browser:
   - `npx playwright install chromium`
4. Spustte:
   - `npm run test:e2e:storefront`
   - nebo `npm run guard:test`

### Poznamky

- `guard:test` tyto smoke testy vola automaticky.
- Handly se primarne resi automaticky:
- `visibility` z posledniho restriktivniho `ProductVisibilityRule`
- `quantity` z posledniho `ProductQuantityRule`, ktery ma skutecne omezeni
- `variant` z posledniho restriktivniho `ProductVariantVisibilityRule`
- K prekladu `productId -> handle` se pouzije offline Shopify session ulozena v Prisma.
- `SHOPIFY_E2E_PRODUCT_HANDLE_*` slouzi jen jako rucni override, kdyz chcete konkretni produkt vynutit.
- Kazdy `SHOPIFY_E2E_PRODUCT_HANDLE_*` je slug z URL produktu.
- Priklad: z URL `https://.../products/my-test-product` je handle `my-test-product`.
- Produkt musi byt publikovany na online store a jeho PDP musi obsahovat standardni `form[action*='/cart/add']`.
