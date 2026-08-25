---
title: Troubleshooting toasts
slug: troubleshooting
layer: support
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [troubleshooting, not showing, not working, free shipping, gift, faq, fix]
summary: Common Won Toasts issues and their causes — toasts not showing, free shipping not applying, gift toasts, branding.
---

# Troubleshooting toasts

## Toasts don't appear at all

1. **Is the app enabled?** Check the toggle on the app **Home** page
   (*Show Won Toasts on the storefront*).
2. **Is the app embed turned on?** In the Shopify **theme editor → App embeds**,
   enable the Won Toasts embed and save. Without it, nothing renders on the
   storefront.
3. **URL exclusions:** the **Targeting** page has *Run everywhere, except…*. A
   path listed there (e.g. `/checkout*`) renders nothing at all.
4. **Targeting (Pro):** if you narrowed by page/device/customer, the current
   visitor may fall outside it. Clear targeting to test.
5. **Quiet mode:** **Design → Anti-spam → Quiet mode** mutes everything until it
   expires.

## "Free shipping unlocked" but checkout still charges shipping

The app **announces** the milestone; it does not make shipping free. Add a matching
free-shipping rate in **Shopify Settings → Shipping and delivery** at the same
subtotal threshold. See [set-up-free-shipping-milestone](../tasks/set-up-free-shipping-milestone.md).

## A free gift was added but no toast (or the wrong toast) showed

Gift lines (added by a gift/gift-ladder mechanism, marked `_gift_progress`) are
deliberately **not** treated as normal "item added" toasts — they surface as a
**gift milestone** instead. See [milestones](../concepts/milestones.md).

## Too many toasts at once

Tune **Design → Anti-spam**: merge first (group by, merge window, `+N`), then the
caps (per session, cooldown, hide after dismiss). Step-by-step:
[tune-anti-spam](../tasks/tune-anti-spam.md), background:
[grouping-and-conflicts](../concepts/grouping-and-conflicts.md).

## A toast fired far less often than expected

It was probably governed, not broken. The suppression order is: quiet mode →
per-session cap → cooldown → hidden after the shopper dismissed it. See
[anti-spam-and-frequency](../concepts/anti-spam-and-frequency.md).

## Low stock / cart activity show nothing

By design — they only speak when the real number supports it. New or quiet stores
see nothing. See
[show-low-stock-and-cart-activity](../tasks/show-low-stock-and-cart-activity.md).

## A shopper sees the wrong language

Check **Markets**: the language must be in *Your languages* and have a
translation, otherwise the fallback chain lands on your default language. See
[translate-toast-messages](../tasks/translate-toast-messages.md).

## The free-shipping bar shows the wrong amount in another currency

Thresholds are set **per currency**, not converted. Fill the missing one under
**Markets → Currencies** — see
[set-thresholds-per-currency](../tasks/set-thresholds-per-currency.md).

## Pro settings stopped applying

The subscription probably ended. Pro settings are kept but not applied on Free;
the server enforces this before the storefront sees the config. See
[upgrade-to-pro](../tasks/upgrade-to-pro.md).

## My custom CSS does nothing

It is injected **inside** the Shadow DOM, so theme selectors do not resolve there.
See [add-custom-css](../tasks/add-custom-css.md).

## "Powered by Won" badge

The badge shows on the **Free** plan. Removing it is a Pro feature. See
[reference/plan-limits](../reference/plan-limits.generated.md).

## A setting didn't take effect

Invalid values are ignored and fall back to the default (this is intentional, to
avoid breaking the storefront). Re-check the value against
[reference/config-options](../reference/config-options.generated.md) and save again.
