---
title: Margin settings per collection (Pro)
slug: margin-per-collection
layer: concept
feature: margin
min_plan: pro
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [margin, collection, per collection, stricter, where protection steps in, impact, pro, low-margin goods]
summary: With Pro, chosen collections get their own minimum margin or ceiling; the strictest value wins. Where protection steps in shows which discounts it lowers and by how much.
---

# Margin settings per collection (Pro)

## Settings per collection

A collection can have its own **minimum margin** and its own **ceiling for products
without a cost price**, for example a stricter one for low-margin goods.

- An empty field means the store-wide setting applies.
- A product in several collections with their own setting gets the **strictest**
  value of them.
- A limited number of collections can have their own setting
  ([reference/limits](../reference/limits.generated.md)).
- If a collection holds more products than Won reads in one sync, its stricter value
  applies to the whole store instead, and the Margin protection page says so.

## Where protection steps in

This overview lists the discounts that margin protection lowers, on which variants
and by how much, the biggest differences first. It is computed from your discount
settings and cost prices, **not from orders**, for one item in the shop currency. It
fills in once the cost prices have been read, which happens while protection is on.

## On Free

Collection settings are merged into the store-wide setting and the **strictest**
value wins, so a discount is never larger than the Pro setup allowed. The admin says
which values changed. The collection settings stay saved.

Background: [margin-protection](margin-protection).
