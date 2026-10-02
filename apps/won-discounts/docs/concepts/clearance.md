---
title: Clearance
slug: clearance
layer: concept
feature: outlet
min_plan: pro
status: beta
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-10-02
keywords: [clearance, sale, outlet, sell off, quota, sell N pieces, strike-through price, compare-at price, price list, výprodej, doprodej, kvóta]
summary: Sell a number of pieces of an existing variant at a discount; the price comes back by itself when the quota is sold, at the end date or by hand.
---

# Clearance

**Clearance** (Pro) sells a number of pieces of
an **existing variant** at a discount and then puts the full price back. No
product is copied, so the SKU, stock and reviews stay as they are.

## What happens when a sale starts

1. Won saves the variant's current **price** and **compare-at price**, and the
   fixed prices of the market price lists you picked. Nothing is changed before
   this backup is stored.
2. The variant is marked as on sale. Checkout then gives it **no other Won
   discount** (a clearance item combines with nothing by default; Settings can
   change that, see [combining-discounts](combining-discounts)).
3. The price drops by your percent (whole percent, 1–90 %). The compare-at price
   becomes the price before the sale, so your theme shows it struck through —
   unless the display is set to *Nothing* (a quiet sale).
4. Each picked price list with a fixed price for the variant gets the same
   percent off its own fixed price. Markets without a fixed price convert the
   lowered base price themselves; no exchange rate is used by Won.

## Counting the quota

Every piece of the variant sold while the sale runs counts, **in every market**,
also where the price stays full. A **cancelled** order and a **refund with
restock** give the pieces back to the quota. An order can arrive a little late
(Shopify sends it to Won after checkout); pieces sold past the quota that way are
shown with their exact number.

## The end

A sale ends when its quota is sold, at its end date (the start of that day in
your store's time zone) or when you end it by hand. Won then puts back every
price that still holds the sale value. **A price you changed yourself during the
sale is never overwritten**; the sale's history says so. Then the sale mark is
removed, so the item takes other discounts again.

A return after the end follows your setting: open the sale again, ask on the
Overview (default), or do nothing.

## On your store

How the sale shows is your choice: nothing, a struck-through price, plus a
"Sale" badge, plus "Only X left" (from the real quota, never below zero). The
badge needs the **Sale badge** block on the product page, see
[../tasks/add-the-sale-badge.md](../tasks/add-the-sale-badge.md). The quantity
tiers table is not shown for a variant on sale (it would promise a discount
checkout does not give).

## Free plan

Clearance is part of Pro. On Free nothing new starts; sales already running
finish (their quota, date or your hand) and their prices come back.
