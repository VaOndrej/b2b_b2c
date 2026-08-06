---
title: Configuration option values
slug: config-options
layer: reference
feature: core
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/toasts'
lang: en
keywords: [config, options, position, animation, theme, locale, targeting]
summary: Every accepted value for behavior, appearance, language and targeting settings.
---

<!-- AUTO-GENERATED from @won/core/toasts — DO NOT EDIT. Run `npm run docs:gen -w won-toasts` to refresh. -->

# Configuration option values

Accepted values for each setting. Invalid or unknown values are ignored and fall
back to the default (the config is version 1).

## Languages (locales)

Languages are **merchant-defined data**, not a fixed list. The app ships English
(`en`) as the built-in fallback; add any BCP-47 locales you need (e.g. `cs`,
`sk`, `de`, `pt-BR`) in Languages settings. Free plans ship up to
2 languages; Pro ships many. Shoppers see the string for their
storefront locale, falling back to your default language.

## Behavior

**Position**

- `top-left`
- `top-center`
- `top-right`
- `middle-left`
- `middle-center`
- `middle-right`
- `bottom-left`
- `bottom-center`
- `bottom-right`

**Click action**

- `none`
- `open-cart`
- `go-to-product`

**Overflow strategy** (when more toasts arrive than fit)

- `queue`
- `collapse`

**Stack direction**

- `newest-top`
- `newest-bottom`

**Grouping mode**

- `off`
- `by-product`
- `by-variant`
- `by-type`

## Appearance

**Theme mode**

- `system`
- `light`
- `dark`
- `custom`

**Animation**

- `slide`
- `fade`
- `pop`
- `slide-scale`

**Icon set**

- `emoji`
- `line`
- `none`

**Shadow**

- `none`
- `sm`
- `md`
- `lg`

**Density**

- `compact`
- `comfortable`

## Targeting *(Pro)*

**Page type**

- `product`
- `collection`
- `cart`
- `home`
- `search`
- `other`

**Device**

- `both`
- `mobile`
- `desktop`

**Customer state**

- `both`
- `guest`
- `logged-in`
