---
title: Appearance and branding
slug: appearance-and-branding
layer: concept
feature: design
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [appearance, design, theme, dark mode, colors, branding, powered by won]
summary: What can be styled (light/dark by default, full design studio on Pro) and when the "Powered by Won" badge shows.
---

# Appearance and branding

## The default look (all plans)

Out of the box, toasts follow a clean neutral design that adapts to **light / dark
/ system** (it respects the shopper's `prefers-color-scheme`) and honors
`prefers-reduced-motion`. This default is fully usable and accessible on the Free
plan — appearance is **scope**, not a quality gate.

## Design studio (Pro)

On Pro, the **Appearance** admin page unlocks the design studio:

- Theme mode and custom colors
- Per-event accent color
- Radius, width, shadow, density
- Animation style (slide / fade / pop / slide-scale)
- Icon set

Accepted values are in
[reference/config-options](../reference/config-options.generated.md). A **live
preview** in the admin renders with the *same* engine as the storefront, so what
you see is what shoppers get.

## Rendering isolation

Toasts render inside a **Shadow DOM** with their own stylesheet and CSS custom
properties, so the theme's CSS can't bleed in and the toasts can't disturb the
theme. This is why they look consistent across themes (Dawn, Horizon, …).

## "Powered by Won" badge

The Free plan shows a small **"Powered by Won"** badge on toasts. Removing it is a
Pro feature (`remove_branding`). See
[reference/plan-limits](../reference/plan-limits.generated.md).

Related: [plans-free-vs-pro](plans-free-vs-pro), task:
[customize-appearance](../tasks/customize-appearance.md).
