---
title: Targeting (where toasts show)
slug: targeting
layer: concept
feature: targeting
min_plan: pro
status: stable
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [targeting, page, device, mobile, desktop, customer, guest, pro]
summary: Targeting (a Pro feature) restricts toasts to specific page types, devices, or customer states.
---

# Targeting (where toasts show)

**Targeting is a Pro feature.** By default toasts show everywhere; targeting lets
you narrow that.

## What you can target

- **Page type** — product, collection, cart, home, search, other. Empty = all pages.
- **Device** — both, mobile only, or desktop only.
- **Customer state** — both, guests only, or logged-in only.

Exact accepted values: [reference/config-options](../reference/config-options.generated.md).

## How it's enforced

Targeting is applied **server-side** (in the app-proxy) before the storefront ever
receives the config, so on the Free plan targeting is simply reset to "show
everywhere" — the storefront just renders whatever it's given.

## One caveat about customer state

The storefront can reliably tell the **page type** and **device**, but it cannot
always tell whether the shopper is logged in. When it can't, the customer-state
filter is ignored (toasts show) rather than guessing wrong.

Related: [plans-free-vs-pro](plans-free-vs-pro), task:
[configure-targeting](../tasks/configure-targeting.md).
