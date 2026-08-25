---
title: What Won Toasts does
slug: what-is-won-toasts
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [overview, cart notifications, toast, what is, introduction, admin, pages, navigation]
summary: Won Toasts shows lightweight cart notifications ("toasts") and progress toward shipping/gift milestones in your storefront.
---

# What Won Toasts does

Won Toasts adds **lightweight cart notifications** ("toasts") to your storefront.
When a shopper adds, removes, or changes items, a small message appears — with the
product image, name, and quantity change — and can nudge them toward rewards like
**free shipping** or a **free gift**. It also shows toasts you configure yourself:
a countdown, an announcement, or honest urgency from live inventory and real
cart activity.

## What a shopper sees

- A toast slides in when the cart changes (add / remove / increase / decrease).
- Removed items show an **Undo** action that re-adds them.
- Progress messages appear as the cart approaches a milestone ("You're $12 away
  from free shipping") and celebrate when it's reached.

## What a merchant controls (in the app admin)

Everything is configuration — there are no code changes. The admin has:

- **Home** — turn the app on, enable the app embed, see reach at a glance.
- **Toasts** — which recipes are on: cart toasts, milestones, countdown,
  announcement, and the Pro urgency recipes.
- **Design** — look (colours, shape, motion), placement, timing, anti-spam,
  custom CSS.
- **Markets** — languages, translations, per-currency thresholds.
- **Targeting** — URL exclusions on every plan; page / device / customer
  narrowing on Pro.
- **Insights** *(Pro)* — impressions, interactions, holdout-proven ROI.
- **Plan** — Free vs Pro, upgrade and cancel.

## Where it runs

Toasts render on the storefront inside a **Shadow DOM** web component, isolated
from the theme's CSS so they look consistent across themes (tested on Dawn and
Horizon). The app **announces** progress — it never changes prices or grants the
reward itself; your Shopify discounts/shipping rules do that.

## Key principle

Won Toasts **notifies, it does not grant.** A "free shipping" toast reflects your
existing Shopify shipping settings; the app only shows progress toward them.

Related: [cart-toasts](cart-toasts), [milestones](milestones),
[notifications-and-recipes](notifications-and-recipes),
[plans-free-vs-pro](plans-free-vs-pro),
[turn-on-won-toasts](../tasks/turn-on-won-toasts).
