---
title: Notification (recipe) types
slug: notification-types
layer: reference
feature: notifications
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/toasts'
lang: en
keywords: [notification, recipe, countdown, announcement, low stock, cart activity, surface, page]
summary: Every notification type a merchant can turn on, which plan it needs, where it can render and which page scopes it accepts.
---

<!-- AUTO-GENERATED from @won/core/toasts — DO NOT EDIT. Run `npm run docs:gen -w won-toasts` to refresh. -->

# Notification (recipe) types

Cart toasts react to the shopper's own cart. **Notifications** (shown in the
admin as recipes on the **Toasts** page) are merchant-configured rules that can
fire on a page view instead. Every one of them is bound by the frequency rules on
the **Design → Anti-spam** section, and by the plan below.

Locked principle: **real data only.** A countdown counts to a date you set, low
stock reads live inventory, cart activity counts genuine server-side add-to-cart
events. The app never invents a number, and stays silent instead of guessing on a
quiet store.

## Types and plan

| Type | Plan |
|---|---|
| `countdown` | Free |
| `stock.low` | Pro |
| `cart.activity` | Pro |
| `announcement` | Free |
| `order.summary` | Pro |
| `order.created` | Pro |

## Order-data types are off at launch

`order.summary` and `order.created` read order data, which needs Shopify's
**Protected customer data** approval. Until that is granted the app ships without
them: the `orders/create` webhook stays off and neither type can fire. Cart
activity does **not** need it — it counts add-to-cart events the app records
itself.

## Aggregate types

These render a **real counted aggregate** (marked `data-won-aggregate` in the
DOM) and show nothing when the underlying count is too low to be honest:

- `cart.activity`
- `order.summary`

## Surfaces

Where a notification may render:

- `toast`
- `banner`
- `persistent-toast`
- `inline`

## Page scopes

Which storefront pages a rule may run on (`all`, or an empty list, means every
page):

- `all`
- `product`
- `collection`
- `cart`
- `home`
- `search`
