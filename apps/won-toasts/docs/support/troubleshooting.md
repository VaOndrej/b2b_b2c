---
title: Troubleshooting toasts
slug: troubleshooting
layer: support
feature: core
min_plan: free
status: stable
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [troubleshooting, not showing, not working, free shipping, gift, faq, fix]
summary: Common Won Toasts issues and their causes — toasts not showing, free shipping not applying, gift toasts, branding.
---

# Troubleshooting toasts

## Toasts don't appear at all

1. **Is the app enabled?** Check the **Overview** page toggle.
2. **Is the app embed turned on?** In the Shopify **theme editor → App embeds**,
   enable the Won Toasts embed and save. Without it, nothing renders on the
   storefront.
3. **Targeting (Pro):** if you set targeting, the current page/device/customer may
   be excluded. Clear targeting to test.

## "Free shipping unlocked" but checkout still charges shipping

The app **announces** the milestone; it does not make shipping free. Add a matching
free-shipping rate in **Shopify Settings → Shipping and delivery** at the same
subtotal threshold. See [set-up-free-shipping-milestone](../tasks/set-up-free-shipping-milestone.md).

## A free gift was added but no toast (or the wrong toast) showed

Gift lines (added by a gift/gift-ladder mechanism, marked `_gift_progress`) are
deliberately **not** treated as normal "item added" toasts — they surface as a
**gift milestone** instead. See [milestones](../concepts/milestones.md).

## Too many toasts at once

Tune grouping and anti-spam on the **Behavior** page (grouping mode, dedupe
window, rate limit, overflow). See
[grouping-and-conflicts](../concepts/grouping-and-conflicts.md).

## "Powered by Won" badge

The badge shows on the **Free** plan. Removing it is a Pro feature. See
[reference/plan-limits](../reference/plan-limits.generated.md).

## A setting didn't take effect

Invalid values are ignored and fall back to the default (this is intentional, to
avoid breaking the storefront). Re-check the value against
[reference/config-options](../reference/config-options.generated.md) and save again.
