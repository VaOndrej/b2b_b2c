---
title: Storefront contract for a custom look
slug: storefront-contract
layer: reference
feature: appearance
min_plan: pro
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [custom look, custom css, css variables, events, ai prompt, storefront blocks, vlastní vzhled, návod pro ai]
summary: What the Won storefront blocks render and expose (roots, classes, data markers, CSS variables, events), for writing a custom look by hand or with an AI.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Storefront contract for a custom look

A custom look (Pro) is **CSS only**: colors as CSS variables and your own CSS rules. The app puts every
rule under the Won blocks automatically, so a rule can never change the rest of your theme. You cannot add
HTML or JavaScript, load files (`url(...)`, `@import`, fonts) or define `@keyframes`; the admin refuses such
CSS and says why. At most 4,000 characters.

## Blocks and their roots

| Block | Where | Root element |
|---|---|---|
| Quantity discount table | product page (app block) | `.won-tiers` with one of `.won-tiers--default`, `--highlight`, `--chips`, `--tiles` |
| Cart panel (progress, gift, code, savings) | cart page and cart drawer | `.won-cart` |
| Sale badge | product page (app block) | `.won-outlet` |

Write selectors as you would inside the block: `.won-tiers__row { … }`. `:root`, `html` and `body` mean
the block itself.

## CSS variables

Set them in the admin (Look → Custom look) or in your CSS on the root:

- `--won-tiers-accent`
- `--won-tiers-line`
- `--won-tiers-max-width`
- `--won-tiers-radius`
- `--won-tiers-tint`
- `--won-topbar-bg`
- `--won-topbar-text`

## Classes

- `.won-campaign`
- `.won-campaign--center`
- `.won-campaign__time`
- `.won-campaign__title`
- `.won-card`
- `.won-cart`
- `.won-cart__applied`
- `.won-cart__bar`
- `.won-cart__code`
- `.won-cart__row`
- `.won-cart__saved`
- `.won-cart__warn`
- `.won-outlet`
- `.won-outlet__badge`
- `.won-outlet__left`
- `.won-outlet__row`
- `.won-outlet__variant`
- `.won-progress`
- `.won-progress--center`
- `.won-progress__row`
- `.won-progress__track`
- `.won-tiers`
- `.won-tiers--chips`
- `.won-tiers--default`
- `.won-tiers--highlight`
- `.won-tiers--tiles`
- `.won-tiers__heading`
- `.won-tiers__list`
- `.won-tiers__live`
- `.won-tiers__next`
- `.won-tiers__qty`
- `.won-tiers__row`
- `.won-tiers__save`
- `.won-tiers__unit`
- `.won-topbar`

## Data markers

Stable hooks for scripts and tests (do not style by them; classes are for styling):

- `data-won-discounts-campaign`
- `data-won-discounts-card`
- `data-won-discounts-cart`
- `data-won-discounts-cart-slot`
- `data-won-discounts-code`
- `data-won-discounts-code-warning`
- `data-won-discounts-currency`
- `data-won-discounts-embed`
- `data-won-discounts-gift`
- `data-won-discounts-hint`
- `data-won-discounts-live-price`
- `data-won-discounts-outlet`
- `data-won-discounts-outlet-badge`
- `data-won-discounts-outlet-left`
- `data-won-discounts-outlet-variant`
- `data-won-discounts-progress`
- `data-won-discounts-saved`
- `data-won-discounts-status`
- `data-won-discounts-tier-next`
- `data-won-discounts-tier-row`
- `data-won-discounts-tiers`
- `data-won-discounts-tiers-data`
- `data-won-discounts-topbar`

## Events

The blocks send these `CustomEvent`s on `document` — read-only signals; the blocks never change the cart by
themselves:

- `won-discounts:cart:update`
- `won-discounts:tiers:update`

- `won-discounts:tiers:update` — `detail: { variantId, quantity, count, min, unitCents }`: the table was
  recalculated (`min` = the reached break's quantity, 0 = none; `unitCents` = the price per item shown).
- `won-discounts:cart:update` — `detail: { base, shipping, gifts }`: the cart panel was redrawn.

## Example

```css
:root { --won-tiers-accent: #0a7d4f; --won-tiers-radius: 4px; }
.won-tiers__heading { text-transform: uppercase; letter-spacing: 0.04em; }
.won-tiers__row[data-active="true"] { font-weight: 700; }
@media (max-width: 600px) { .won-tiers__unit { display: none; } }
```

## Prompt for an AI

> Write CSS for the Won Discounts storefront blocks of my Shopify store. Use only the classes, CSS variables and
> roots listed in this document. CSS only: no HTML, no JavaScript, no `url()`, no `@import`, no
> `@font-face`, no `@keyframes`; `@media`, `@supports` and `@container` are allowed. At most
> 4,000 characters. Selectors are relative to the block (`:root` = the block). The
> look I want: <describe it>.
