---
title: The clearance quota is not counting sold pieces
slug: clearance-quota-not-counting
layer: support
feature: outlet
min_plan: pro
status: beta
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-10-02
keywords: [quota not counting, sold pieces not counted, clearance did not end, sale not ending, orders access, protected customer data, kvóta se neodečítá, výprodej neskončil]
summary: Until Shopify approves the app's access to orders, the clearance quota is not counted; the sale ends by its end date or by hand.
---

# The clearance quota is not counting sold pieces

The quota counts the pieces sold in orders. Shopify gives an app the orders only
after it approves the app's access to **protected customer data**. Until then
the Clearance screen and its Overview card say:

> The quota is not counted yet — the sale ends by its date or by hand.

What it means for a running sale:

- "Sold" stays at 0 and "left" stays at the full quota; cancellations and
  refunds are not counted either.
- The sale **does not end by selling out**. It ends at its end date (the start
  of that day in your store's time zone) or when you click **End sale**.
- Prices come back at the end as usual.

What to do: give every sale an **end date** when you start it (the form reminds
you), or end it by hand when the stock is gone. Once the access is approved, the
warning disappears and new orders count; orders placed before that are not
counted back.

See [../concepts/clearance.md](../concepts/clearance.md).
