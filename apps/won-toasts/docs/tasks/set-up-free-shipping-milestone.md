---
title: Set up a free-shipping milestone
slug: set-up-free-shipping-milestone
layer: task
feature: milestones
min_plan: free
status: stable
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [free shipping, milestone, threshold, setup, how to, progress bar]
summary: How to configure a free-shipping progress milestone, and the Shopify setting that actually makes shipping free.
---

# Set up a free-shipping milestone

Won Toasts shows the shopper how close they are to free shipping and celebrates
when they cross the threshold.

## Steps

1. In the app admin, open **Events & messages**.
2. Add a **free shipping** milestone and set the **subtotal threshold** (the cart
   amount at which shipping becomes free).
3. Optionally edit the progress and celebration message templates (per language).
4. Save.

Free plans can have up to a limited number of active milestones — see
[reference/plan-limits](../reference/plan-limits.generated.md).

## Important: this announces, it does not grant

The milestone **only shows progress**. Shipping actually becomes free because of
your **Shopify shipping settings**, not the app. Set a matching free-shipping rate
in **Shopify Settings → Shipping and delivery** (a free rate above the same
subtotal). Keep the two thresholds equal.

If a toast says "free shipping unlocked" but checkout still charges shipping, the
Shopify shipping rate is the thing to fix — the app is reporting progress toward a
threshold you set, it never changes the shipping price.

Related: [milestones](../concepts/milestones.md).
