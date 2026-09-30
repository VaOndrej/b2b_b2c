---
title: A product did not get the global quantity tiers
slug: product-did-not-get-the-global-tiers
layer: support
feature: tiers
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [product no global tiers, missing quantity tiers, scoped tier set, one set per product, product excluded, produkt nedostal globální úrovně]
summary: A product with no quantity tiers is covered by a scoped Pro set that excludes it; only one tier set ever applies per product, scoped sets before the global one.
---

# A product did not get the global quantity tiers

## Why it happened

Exactly one tier set applies to a product: a set scoped to that product, then
a set scoped to one of its collections, then the one global set — the first
match wins, the rest are not even considered. See
[../concepts/quantity-tiers.md](../concepts/quantity-tiers.md).

If the product is included in a Pro product- or collection-scoped set (even
one with **no breaks**, or switched off in a way that still claims the
product), it never falls through to the global set. This is intentional: a
scoped set is how you give a product different — often lower — tiers than the
default, or none at all.

## How to check

1. Open **Quantity tiers** and look at each scoped set's product and
   collection list for this product.
2. If a scoped set claims it, remove the product (or its collection) from that
   set's scope, or add breaks to that set, to change what it gets.
3. If no scoped set claims it, check that the global set itself has breaks and
   is not empty.

## On Free

Scoped sets are a Pro feature. If the shop was Pro and is now on Free, scoped
sets are not deleted, only switched off, so the product they excluded keeps
getting **no** tiers rather than unexpectedly falling into the global set. See
[../concepts/plans-free-vs-pro.md](../concepts/plans-free-vs-pro.md).
