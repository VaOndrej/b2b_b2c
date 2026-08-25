---
title: Notifications (recipes) beyond the cart
slug: notifications-and-recipes
layer: concept
feature: notifications
min_plan: free
status: stable
app_version: MVP9
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [recipe, notification, countdown, announcement, low stock, cart activity, page view, social proof]
summary: Recipes are merchant-configured toasts that fire on page views rather than on the shopper's own cart — countdown, announcement, low stock and cart activity.
---

# Notifications (recipes) beyond the cart

[Cart toasts](cart-toasts) react to what *this* shopper just did. **Recipes** —
listed on the **Toasts** page in the admin — are rules you switch on yourself, and
they can fire on a page view instead of a cart change.

## The recipes

| Recipe | What the shopper sees | Plan |
|---|---|---|
| **Cart toasts** | Every add, remove and quantity change confirmed | Free |
| **Countdown timer** | A real deadline ticking down | Free |
| **Announcement** | Your own message — a sale, a shipping cutoff | Free |
| **Low-stock urgency** | "Only 3 left" — when there really are 3 | Pro |
| **Cart activity** | How many people added this recently | Pro |

Exact machine names, surfaces and page scopes:
[reference/notification-types](../reference/notification-types.generated.md).

## Real data only

This is the rule the app will not bend. A countdown counts to a date **you** set.
Low stock reads **live** inventory and stays silent when stock is healthy. Cart
activity counts genuine add-to-cart events the app recorded server-side.

Consequence you should expect: **on a quiet store, the social-proof recipes show
nothing.** That is not a bug — the app would rather say nothing than invent a
number. See [insights-and-roi](insights-and-roi) for the same principle applied
to metrics.

## Everything passes the frequency rules

No recipe can flood a shopper. Every one of them is checked against the caps,
cooldowns and quiet mode described in
[anti-spam-and-frequency](anti-spam-and-frequency) before it renders — including
your own announcement.

## Where they show

Each recipe can be limited to certain pages, and the whole app can be limited by
[targeting](targeting) (Pro) and by URL exclusions.

Related: [cart-toasts](cart-toasts), [anti-spam-and-frequency](anti-spam-and-frequency),
[plans-free-vs-pro](plans-free-vs-pro).
