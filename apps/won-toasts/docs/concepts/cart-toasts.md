---
title: Cart toasts and how they trigger
slug: cart-toasts
layer: concept
feature: cart-toasts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [cart, add to cart, remove, undo, notification, trigger, delta]
summary: How cart toasts detect add/remove/change events, show the quantity delta, and offer Undo on removals.
---

# Cart toasts and how they trigger

A **cart toast** is the notification shown when the shopper's cart changes.

## How a change is detected

Won Toasts watches storefront cart requests (`/cart/add`, `/cart/change`,
`/cart/update`, `/cart/clear`) and the theme's `cart:updated` event, then
reconciles against the real cart (`/cart.js`). It shows the **net change**, so
three quick adds of the same product become **one** toast reading `+3`, not three
separate ones.

Each toast derives from a cart event of one of these kinds: item **added**,
**removed**, **increased**, or **decreased**. The exact machine-readable list is
in [reference/event-types](../reference/event-types.generated.md).

## What a toast contains

- Product image and name
- The quantity change (delta, e.g. `+2` / `−1`)
- A colored accent that depends on the event type
- On **removals**: an **Undo** action

## Undo

Undo is the **only** cart write the app performs on its own, and only when the
shopper clicks it — it re-adds the removed item. Everything else is read-only
observation of the cart.

## What it does not do

- It does not create a second product form or change add-to-cart behavior.
- It does not modify prices.
- It ignores gift lines (`_gift_progress`) so a system-added free gift does not
  fire a normal "item added" toast — those are handled as
  [milestones](milestones).

Related: [grouping-and-conflicts](grouping-and-conflicts),
[appearance-and-branding](appearance-and-branding).
