---
title: Performance and theme compatibility
slug: performance-and-compatibility
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [performance, speed, lighthouse, page speed, theme, dawn, horizon, shadow dom, css conflict, app embed]
summary: How much Won Toasts weighs on the storefront, why it cannot clash with your theme's CSS, and which themes it is tested against.
---

# Performance and theme compatibility

## Weight on the storefront

The storefront script is a single asset served by Shopify's CDN through a theme
app extension, held under a hard **11 kB gzipped** budget that is enforced by a
test in the release gate — the build fails rather than quietly getting heavier.
It does not block rendering and does not reserve layout space, so it cannot cause
layout shift.

There is no `<script>` tag injected into your theme, no ScriptTag API, and no
theme file is modified.

## Why it can't clash with your theme

Toasts render inside a **Shadow DOM** web component. Your theme's CSS cannot
reach into it and its CSS cannot leak out — which is why a toast looks the same
on a heavily customized theme as on a stock one.

The consequence worth knowing: if you write [custom CSS](../tasks/add-custom-css)
(Pro), it is applied *inside* that shadow root against the app's own class names,
not against your theme's selectors.

## Themes it is tested on

Dawn and Horizon, in both desktop and mobile viewports, as part of the release
gate. Other Online Store 2.0 themes work the same way — the app only needs the
app embed, not specific theme markup.

## What it reads from the storefront

The shopper's cart, via Shopify's own cart endpoints, to detect what changed.
It writes to the cart exactly once, and only when a shopper clicks **Undo** on a
removed item. It never changes prices, quantities or discounts on its own.

Related: [what-is-won-toasts](what-is-won-toasts), [accessibility](accessibility).
