---
title: Event and milestone types
slug: event-types
layer: reference
feature: cart-toasts
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/toasts'
lang: en
keywords: [event, type, cart, milestone, semantic, accent]
summary: The cart event types, semantic toast types, and milestone kinds the engine recognizes.
---

<!-- AUTO-GENERATED from @won/core/toasts — DO NOT EDIT. Run `npm run docs:gen -w won-toasts` to refresh. -->

# Event and milestone types

## Cart event types

The net change detected on the cart that produces a toast:

- `added`
- `removed`
- `increased`
- `decreased`

## Semantic toast types

Each toast has a semantic type that drives its accent color, icon and message
template:

- `added`
- `removed`
- `increased`
- `decreased`
- `gift`
- `shipping`
- `discount`
- `info`

## Milestone kinds

Rewards a milestone can track (the app announces progress; it does not grant the
reward):

- `free_shipping`
- `gift`
- `qty_discount`
