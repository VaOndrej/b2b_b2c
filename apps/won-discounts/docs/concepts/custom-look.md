---
title: A custom look of the storefront blocks
slug: custom-look
layer: concept
feature: appearance
min_plan: pro
status: beta
app_version: MVP7
source: hand-written
generated_from: null
lang: en
updated: 2026-10-04
keywords: [custom look, custom css, colours, corner radius, css variables, ai, design, vlastní vzhled, vlastní css, barvy]
summary: On Pro you can set colours, the corner radius and your own CSS for the Won blocks; the app confines every rule to the blocks, so the rest of the theme never changes.
---

# A custom look of the storefront blocks

## What you can change

On **Look → Custom look** (Pro):

- **Accent colour**, **line colour**, **background tint** — as `#rgb` or `#rrggbb`. Empty means the theme's own.
- **Corner radius** in pixels, 0–32.
- **Custom CSS** — your own rules for the quantity discount table, the cart panel, the sale badge and the line on
  product cards.

One of the four ready-made looks still decides the layout; the custom look is applied on top of it.

## Why it cannot break your theme

Every rule you write is placed **under the Won blocks** before it reaches your store: `.won-tiers__row { … }`
only ever matches a row of the Won table, and `:root`, `html` or `body` mean the block itself. CSS that could
reach outside or load something is refused when you save, with the reason: `url(...)`, `@import`, `@font-face`,
`@keyframes`, a backslash, `<`, unbalanced braces. `@media`, `@supports` and `@container` are allowed. At most
4,000 characters. There is no custom HTML or JavaScript.

## Having an AI write it

**Copy the brief for an AI** copies a ready prompt with the classes and variables of the blocks. Add what the look
should be, give it to your AI, and paste the CSS it returns into **Custom CSS**. The full contract (classes, data
markers, events) is in [storefront-contract](../reference/storefront-contract.generated.md).

## On Free

The custom look is saved but not applied; your store uses the chosen ready-made look. Back on Pro it applies again.
