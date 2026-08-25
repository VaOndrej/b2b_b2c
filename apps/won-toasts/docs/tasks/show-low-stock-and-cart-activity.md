---
title: Show low stock and cart activity (Pro)
slug: show-low-stock-and-cart-activity
layer: task
feature: notifications
min_plan: pro
status: stable
app_version: MVP12
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [low stock, scarcity, only 3 left, cart activity, social proof, urgency, inventory, pro]
summary: Turn on the two honest urgency recipes — live inventory and server-counted add-to-cart activity — and understand when they stay silent.
---

# Show low stock and cart activity (Pro)

Both recipes are Pro. Both read real data, and both show **nothing** when the real
data does not support a claim.

## Low-stock urgency

1. **Toasts** → **Low-stock urgency** → turn on **Show low-stock nudges**.
2. Set **Show when inventory is below** — the threshold at which a product counts
   as scarce.
3. Save.

It reads your live inventory. Above the threshold, the shopper sees nothing. There
is no way to make it say "only 3 left" when there are 300 — that is the point.

## Cart activity

1. **Toasts** → **Cart activity** → turn on **Show cart activity**.
2. Set **Look back over** — how many hours of activity to count (24 = one day).
3. Save.

It counts genuine add-to-cart events the app recorded server-side. It does **not**
need order access or Shopify's protected customer data approval.

## Why it might show nothing

Because the number is real. A new or quiet store has no activity to report, and
the app stays silent instead of inventing one. If you need something visible on
day one, use [countdown](set-up-a-countdown) or
[announcement](create-an-announcement) — both work with no history.

Related: [notifications-and-recipes](../concepts/notifications-and-recipes),
[insights-and-roi](../concepts/insights-and-roi).
