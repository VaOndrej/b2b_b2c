# F-M3: změna nákupní ceny vyvolá `inventory_items/update` (jen `read_products`)

Ověřeno 2026-09-29 na dev storu `b2b-b2c-store-development.myshopify.com`, běžící `shopify app dev`.

- **Odběr:** `shopify.app.toml` → `inventory_items/update` na `/webhooks/costs`, `include_fields` = id, cost, updated_at, admin_graphql_api_id.
- **Scope:** appka má `read_products, read_themes, write_discounts, write_products`, žádný `read_inventory`.
- **Převzetí odběru:** běžící `app dev` po uložení tomlu vypsal „App config updated … Updated dev preview“ (14:04:35). Restart nebyl potřeba.

## Kroky

1. `productVariantsBulkUpdate`: won-e2e-simple-a, nákupní cena 6.00 → 6.50 (12:15:21 UTC).
2. Stejná mutace zpět 6.50 → 6.00 (12:16:01 UTC).

Obě mutace běžely jménem appky přes `shopify app execute`. `userErrors` byly prázdné.

## Výsledek

Po každé změně přišlo jedno doručení s platným HMAC (`app-dev.log`):

```
[shopify-api/DEBUG] webhook request is valid
Received INVENTORY_ITEMS_UPDATE webhook for b2b-b2c-store-development.myshopify.com
```

- Ochrana marže je v configu dev storu vypnutá, takže handler nic nezařadil. Při vypnuté marži zrcadlo neběží, to je záměr.
- Nákupní cena je vrácená na 6.00 USD.
- Surová data (mutace, odpovědi, řádky logu) jsou v `f-m3-inventory-items-update.json`.

## Neověřeno

- Zápis variant metafieldu ze živého webhooku při zapnuté marži. Běžící `app dev` ještě nemá migraci s tabulkou `VariantCost`, tu doplní až restart. Zápis ověří T5b.
- Jestli změna samotné nákupní ceny vyvolá i `products/update`. V logu se neobjevil, ale targeting route loguje jen relevantní doručení, takže to nic nedokazuje.
