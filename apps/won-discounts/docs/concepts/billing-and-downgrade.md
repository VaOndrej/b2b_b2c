---
title: Billing, the trial and going back to Free
slug: billing-and-downgrade
layer: concept
feature: plans
min_plan: free
status: beta
app_version: MVP7
source: hand-written
generated_from: null
lang: en
updated: 2026-10-04
keywords: [billing, subscription, trial, 14 days, 29 usd, cancel pro, downgrade, charge, test charge, předplatné, zkušební doba, zrušit pro]
summary: Pro is billed by Shopify at 29 USD a month after a 14-day trial; cancelling makes the store Free at once, running campaigns and sales finish, and Pro settings stay saved.
---

# Billing, the trial and going back to Free

## How Pro is billed

Pro costs **29 USD a month**, charged by **Shopify** on your Shopify invoice — the
app never asks for a card. The first **14 days are free**. There is no yearly plan
and no limit on orders.

Clicking **Try Pro free for 14 days** in **Settings** under **Plan** opens Shopify's own
confirmation page. Pro starts when you approve it there; until then the store stays
on Free and nothing is charged. On a development store the charge is a **test
charge**: no money moves.

## What the app trusts

The plan in force is what Shopify reports about your subscription. The app checks it
every time you open **Settings**, the moment Shopify reports a change (approved,
cancelled, expired, frozen), and once a day. If Shopify cannot be reached, the last
known plan is kept for up to 3 days; after that the store is treated as Free until
Shopify answers again.

## Cancelling Pro (going back to Free)

**Cancel Pro** in **Settings** under **Plan** (it asks first) ends the subscription in Shopify. From that moment:

- the store is on **Free** and discounts are recalculated at once — Pro-only
  settings stop applying at checkout (see [plans-free-vs-pro](plans-free-vs-pro));
- a **campaign that is running** finishes at its end, and a **clearance sale that
  is running** finishes too (its prices go back when it ends) — the Plan section lists
  them before you click;
- nothing new that needs Pro can be started;
- your Pro **settings stay saved** and apply again if you come back to Pro.

Uninstalling the app also ends the subscription. Before you uninstall, see
[prepare-for-uninstalling](../tasks/prepare-for-uninstalling.md).
