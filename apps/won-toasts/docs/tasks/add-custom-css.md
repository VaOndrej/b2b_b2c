---
title: Add custom CSS (Pro)
slug: add-custom-css
layer: task
feature: design
min_plan: pro
status: stable
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [custom css, styling, shadow dom, selector, brand, font, override, pro]
summary: Style toasts beyond the design studio with your own CSS, and what to know about the shadow root it runs in.
---

# Add custom CSS (Pro)

**Design → Custom CSS**. Up to 4000 characters.

## It runs inside the shadow root

Toasts live in a Shadow DOM, so your CSS is injected *inside* that shadow root.
Two consequences:

- Your **theme's** selectors and variables are not visible in there. Copying a
  rule from your theme stylesheet will usually do nothing.
- Your rules cannot leak out and break the rest of the page — which is why this
  feature can be offered at all.

Target the app's own elements and the CSS custom properties the design studio
sets, rather than theme class names.

## Try the design studio first

Colours, corner radius, width, shadow, density, animation, per-event accent, icon
style and font are all fields in **Design** — no CSS needed, and they stay
consistent with the live preview. Reach for custom CSS only for what those fields
cannot express.

## Preview it

The live preview on the Design page renders through the same component as the
storefront, so what you see there is what a shopper gets.

## If it stops applying

Custom CSS is Pro. On Free it is kept but not applied — see
[upgrade-to-pro](upgrade-to-pro).

Related: [appearance-and-branding](../concepts/appearance-and-branding),
[performance-and-compatibility](../concepts/performance-and-compatibility).
