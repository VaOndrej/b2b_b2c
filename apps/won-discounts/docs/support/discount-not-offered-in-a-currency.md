---
title: The discount is not offered in EUR (or another currency)
slug: discount-not-offered-in-a-currency
layer: support
feature: markets
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [eur, currency, not offered, missing value, slovakia, market, fixed amount, minimum, exchange rate, v EUR se sleva nenabízí]
summary: Why a Won discount works in one currency but not in another (a missing value, never converted), and how to fix it.
---

# The discount is not offered in EUR (or another currency)

## The usual cause: no value for that currency

Won never converts amounts by exchange rate. A **fixed amount** and a **minimum order
amount** each need their own value for every currency. Without it, the discount is
not offered in that currency. The Overview warns: "isn't offered in EUR. The value is
missing."

**Fix:** open the discount in **Discounts & codes** and fill in the amount in EUR,
and the minimum in EUR if the discount has a minimum.

A percentage discount needs no amount, but if it has a minimum order amount only in
CZK, it is not offered in EUR.

## Other causes

- **The discount was moved from Shopify.** It came with the shop currency only; add
  the others.
- **Market targeting (Pro)**: the discount is limited to markets that do not include
  the customer's country. On Free a market-limited discount does not apply at all.
- **The market is switched off in Won**: a discount that targets only switched-off
  markets shows "Not running".
- **No price in that currency**: Try a cart cannot calculate a product that has no
  price in the chosen market's currency.

Check with [Try a cart](../tasks/try-a-cart.md) and the EUR market: it says "has no
amount for EUR, so it is not offered here" when the value is missing. Background:
[../concepts/markets-and-currencies.md](../concepts/markets-and-currencies.md).
