---
title: Create an automatic discount
slug: create-an-automatic-discount
layer: task
feature: discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [create discount, new discount, automatic, sale, percentage, fixed amount, free shipping, recipe, minimum order, schedule]
summary: Set up a discount that applies by itself (a sale, an amount off the order, free shipping above an amount), from a recipe or blank.
---

# Create an automatic discount

1. Open **Discounts & codes** and start a **New discount**, or pick a recipe (for
   example "% off everything" or "Free shipping"). A recipe pre-fills the values; you
   only check them.
2. **Name**: customers see it in the cart and at checkout.
3. **Discount type**: Percentage, Fixed amount or Free shipping.
   - A fixed amount has its own value **per currency**. Leave a currency empty and
     the discount is not offered there. Nothing is converted.
4. **Applies to**: Whole order, Products, Collections or Shipping. For products or
   collections, select them.
5. **Applies**: Automatically.
6. Optional, under **More options**:
   - **Minimum order** per currency and/or a minimum quantity, and whether the
     minimum counts the whole cart or only the selected products.
   - **When it runs**: from and until (inclusive), whole days in the shop's time
     zone.
7. Save.

## Check it

- The discount's status turns **Live** once it is in Shopify. "Not synced" means it
  is saved but not in Shopify yet; checkout still runs the previous state. See
  [../concepts/saving-and-syncing.md](../concepts/saving-and-syncing.md).
- **Try it in a cart** from the editor shows what a real cart gets. See
  [try-a-cart](try-a-cart).
- If another product discount targets the same items, the better one for the
  customer wins: [../concepts/combining-discounts.md](../concepts/combining-discounts.md).

All options and what each recipe pre-fills:
[../reference/discount-options.generated.md](../reference/discount-options.generated.md).
