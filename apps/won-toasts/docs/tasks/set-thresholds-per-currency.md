---
title: Set free-shipping thresholds per currency
slug: set-thresholds-per-currency
layer: task
feature: markets
min_plan: free
status: stable
app_version: MVP10
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [currency, multi-currency, threshold, free shipping, markets, presentment currency, exchange rate]
summary: Give each presentment currency its own free-shipping threshold so the progress bar always matches your real Shopify shipping rate.
---

# Set free-shipping thresholds per currency

1. Turn the free-shipping milestone on first — **Toasts** → **Cart toasts** →
   **Free-shipping threshold**. See
   [set-up-free-shipping-milestone](set-up-free-shipping-milestone).
2. Go to **Markets** → **Currencies**.
3. For each **Currency**, enter its **Threshold** — the amount in that currency,
   not a converted number.
4. Save.

## Why per currency and not converted

An automatically converted threshold drifts with the exchange rate, so the bar the
shopper sees stops matching the free-shipping rate you set in **Shopify Settings →
Shipping and delivery**. Entering the number per currency keeps the promise and
the actual rate aligned.

Set each threshold to the same number as the matching Shopify shipping rate for
that market.

## Plan limits

Free keeps a limited number of per-currency thresholds. When you exceed it, the
ones kept are chosen alphabetically by ISO code — deterministically, so a
shopper's progress bar never changes between page loads. Exact numbers in
[reference/plan-limits](../reference/plan-limits.generated.md).

Related: [markets-languages-currencies](../concepts/markets-languages-currencies),
[milestones](../concepts/milestones).
