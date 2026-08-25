---
title: Turn on Won Toasts (go live)
slug: turn-on-won-toasts
layer: task
feature: core
min_plan: free
status: stable
app_version: MVP6
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [install, setup, go live, app embed, enable, theme editor, first steps, getting started]
summary: The two switches that put toasts on your storefront — the app toggle and the theme app embed — and how to verify it worked.
---

# Turn on Won Toasts (go live)

Nothing shows on the storefront until **both** switches are on. The app's home
page walks you through it under **Go live**.

## 1. Turn on the app

Home → **Turn on Won Toasts** → enable *Show Won Toasts on the storefront*.

## 2. Enable the app embed

Home → **Enable the app embed**. This deep-links you into the Shopify **theme
editor → App embeds**. Switch Won Toasts on and **Save**.

This step exists because Shopify requires the merchant to allow an app onto the
theme. Won Toasts never edits your theme files.

## 3. Verify

Open your storefront and add something to the cart. You should see a toast.

If nothing appears, the home page shows the live status of both switches — an
embed that was never saved is the single most common cause. See
[troubleshooting](../support/troubleshooting).

## 4. Then configure

- **Toasts** — which recipes are on ([notifications-and-recipes](../concepts/notifications-and-recipes))
- **Design** — look, placement, timing, anti-spam ([customize-appearance](customize-appearance))
- **Markets** — languages and per-currency thresholds ([translate-toast-messages](translate-toast-messages))
- **Targeting** *(Pro)* — where they show ([configure-targeting](configure-targeting))

New store with no traffic yet? Start with the cold-start-safe recipes — cart
toasts, countdown and announcement — which work without any order history.
