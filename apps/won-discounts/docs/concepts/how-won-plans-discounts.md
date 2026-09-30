---
title: How Won decides which discounts apply
slug: how-won-plans-discounts
layer: concept
feature: engine
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [engine, how it works, checkout, preview, try a cart, plan, one engine, same result, order of discounts]
summary: One engine plans the discounts for a cart; Try a cart, the editor preview and checkout all run it, so checkout takes off what the admin shows.
---

# How Won decides which discounts apply

## One engine, the same answer everywhere

For a given cart, Won's engine works out the complete discount plan: which
discounts apply, to which items, how much, and why the others do not. The **same
engine** runs in **Try a cart**, in the discount editor's preview and at checkout.
For the same products, market, codes and day, checkout takes off what Try a cart
shows.

## How it reaches checkout

Won keeps its discounts in Shopify as app discounts:

- one automatic discount named **Won Discounts** carries every automatic Won discount;
- every code discount is its own Shopify code discount with all its codes.

Each of them computes the same full plan and gives only its own part, so they never
disagree. Change Won discounts in Won; the Shopify copies are written by Won. If the
automatic "Won Discounts" discount is deleted or switched off in Shopify, the
Overview says so and **Sync again** restores it.

## The order of decisions

1. **Which discounts are in play**: switched on; for a code discount, one of its
   codes entered; inside its dates (whole days in the shop's time zone); a value in
   the cart's currency; items it targets in the cart; its minimum met.
2. **Product discounts**: on each item the better one for the customer wins.
3. **Order discount**: taken from the subtotal after product discounts.
4. **Shipping discount**: one applies.
5. **Margin protection** (when on): lowers anything that would go below the floor.

Details: [combining-discounts](combining-discounts),
[margin-protection](margin-protection).

## What the engine cannot see

Discounts that run outside Won (created in Shopify or by another app) are not part
of the plan. See [discounts-outside-won](discounts-outside-won).

## Checkout is never blocked

Won only ever lowers prices. If checkout cannot read Won's settings, Won discounts
simply do not apply until the next successful sync; the order still goes through.
See [saving-and-syncing](saving-and-syncing).
