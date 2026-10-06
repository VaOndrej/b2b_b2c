---
title: Create a discount code
slug: create-a-discount-code
layer: task
feature: discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [discount code, coupon, create code, welcome code, newsletter, influencer, usage limit, once per customer, several codes]
summary: Set up a discount that applies only with a code, add several codes to it, and set usage limits.
---

# Create a discount code

1. Open **Discounts → Discounts & codes** and start a **New discount**, or the **Welcome code**
   recipe (10 % once per customer).
2. Fill in the name, discount type, value and what it applies to, as for an
   automatic discount ([create-an-automatic-discount](create-an-automatic-discount)).
3. **Applies**: With a code.
4. **Codes**: one per line. Case does not matter. Put several codes into one discount
   when they should give the same thing (for example one code per influencer).
5. Optional, under **More options** → **Limits**: total uses at most, and once per
   customer. Only code discounts have limits.
6. Save.

## Before you save

- A code can belong to one discount only, in Won and in Shopify. If Shopify already
  has a discount with that code, change the code or move that discount into Won
  ([move-native-discounts](move-native-discounts)).
- The number of **active code discounts** is limited; the editor shows how many you
  have. Adding a code to an existing code discount does not count against it. See
  [../concepts/codes-vs-automatic-discounts.md](../concepts/codes-vs-automatic-discounts.md).

## Check it

Customers enter the code at checkout. To test without ordering, open
[try-a-cart](try-a-cart), add products and enter the code. It tells you whether the
code applies and, if not, why.
