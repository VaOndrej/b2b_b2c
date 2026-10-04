---
title: Prices by quantity on product cards (BETA)
slug: card-prices
layer: concept
feature: tiers
min_plan: free
status: beta
app_version: MVP7
source: hand-written
generated_from: null
lang: en
updated: 2026-10-04
keywords: [card prices, product card, collection page, search, first break, from 3 items, quantity price on cards, ceny na kartách, karta produktu]
summary: With card prices on, product cards in collections and search show the first quantity break; a card shows nothing where checkout might give less, so it never over-promises.
---

# Prices by quantity on product cards (BETA)

## What a card shows

With **Look → Prices by quantity on product cards** switched on, a product card shows one short line: the **first
break** of the product's quantity discount, for example *From 3 items −10%* or *From 3 items −5 Kč each*. Only the
first break — never "up to 30%".

## When a card shows nothing

A card stays silent whenever the promise could turn out untrue at checkout:

- the product has no quantity discount (or its set has no break);
- a variant of the product is on a clearance sale (unless you allow sale items to combine with everything);
- margin protection is on and the product has a purchase cost, or the break is higher than the product's maximum
  discount, or the break is an amount;
- an amount break has no amount in the visitor's currency, or is more than the cheapest variant's price;
- the product has more than 50 variants.

The product page still shows the full table with exact prices.

## Where it appears

- **Any theme**: after you switch it on, the line appears by itself on the **first 50 products** of a collection
  or search page (the first page of results). Later pages and products loaded by "load more" do not get it.
- **Themes whose product card takes app blocks** (Horizon): click **Add the block to the product card** and drop the
  block into the card. Then every card on every page has the line, and no script is needed.

It is BETA: where the line sits in the card depends on the theme. Adjust it with a
[custom look](custom-look) if needed.
