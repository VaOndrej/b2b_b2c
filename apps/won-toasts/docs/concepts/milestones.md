---
title: Milestones (free shipping and free gift)
slug: milestones
layer: concept
feature: milestones
min_plan: free
status: stable
app_version: MVP4
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [milestone, free shipping, free gift, threshold, progress, gift ladder]
summary: Milestones show progress toward a reward (free shipping, free gift); the app announces progress but does not grant the reward.
---

# Milestones (free shipping and free gift)

A **milestone** is a reward the shopper is working toward — most commonly **free
shipping** at a cart subtotal, or a **free gift**. Won Toasts shows progress and
celebrates crossing the threshold.

## How progress is tracked

As the cart changes, each milestone moves through a small set of states:

- **unreached** — below the threshold
- **approaching** — close to it
- **just_reached** — crossed it on this change (fires the celebration once)
- **reached** — still met
- **just_lost** — dropped back below (resets, so it can celebrate again later)

A milestone is celebrated **once** per cart, tracked per cart token, and re-armed
if the shopper falls back below the threshold.

## Free shipping

Configured with a subtotal **threshold**. The toast shows the remaining amount
("$12 away from free shipping") and celebrates at the threshold. The subtotal used
is the eligible cart subtotal.

## Free gift / Gift Ladder

Won Toasts detects a **gift line** on the cart (the `_gift_progress` line-item
convention) and treats reaching it as a gift milestone. This integrates with a
Gift Ladder setup **without requiring** any specific other app — it only reads the
line convention.

## Announce, don't grant

Milestones **announce** progress. The actual free shipping or gift is delivered by
your **Shopify shipping rules / discounts / gift automation** — Won Toasts never
grants a reward or changes a price. If a toast says "free shipping unlocked" but
shipping still costs money at checkout, the Shopify shipping rule is the thing to
check, not the app.

Related: [cart-toasts](cart-toasts), [grouping-and-conflicts](grouping-and-conflicts),
task: [set-up-free-shipping-milestone](../tasks/set-up-free-shipping-milestone.md).
