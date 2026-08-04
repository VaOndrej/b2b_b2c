---
title: What Won Toasts does
slug: what-is-won-toasts
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP0
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [overview, cart notifications, toast, what is, introduction]
summary: Won Toasts shows lightweight cart notifications ("toasts") and progress toward shipping/gift milestones in your storefront.
---

# What Won Toasts does

Won Toasts adds **lightweight cart notifications** ("toasts") to your storefront.
When a shopper adds, removes, or changes items, a small message appears — with the
product image, name, and quantity change — and can nudge them toward rewards like
**free shipping** or a **free gift**.

## What a shopper sees

- A toast slides in when the cart changes (add / remove / increase / decrease).
- Removed items show an **Undo** action that re-adds them.
- Progress messages appear as the cart approaches a milestone ("You're $12 away
  from free shipping") and celebrate when it's reached.

## What a merchant controls (in the app admin)

Everything is configuration — there are no code changes. The admin has:

- **Overview** — enable/disable the app, install check.
- **Behavior** — position, duration, max visible, stacking, grouping/anti-spam.
- **Appearance** — colors, radius, animation, light/dark, per-event accent.
- **Events & messages** — message templates per event type and language.
- **Targeting** *(Pro)* — where toasts show (page / device / customer).
- **Plan** — Free vs Pro overview.

## Where it runs

Toasts render on the storefront inside a **Shadow DOM** web component, isolated
from the theme's CSS so they look consistent across themes (tested on Dawn and
Horizon). The app **announces** progress — it never changes prices or grants the
reward itself; your Shopify discounts/shipping rules do that.

## Key principle

Won Toasts **notifies, it does not grant.** A "free shipping" toast reflects your
existing Shopify shipping settings; the app only shows progress toward them.

Related: [cart-toasts](cart-toasts), [milestones](milestones),
[plans-free-vs-pro](plans-free-vs-pro).
