---
title: Combinations per discount (Pro)
slug: pro-combinations
layer: concept
feature: engine
min_plan: pro
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [stacks with, combine, stack, per discount, pro, combinations, two codes, 6 discounts, kombinace per sleva]
summary: With Pro a discount can stack with chosen other discounts of the same kind. How the stack is chosen, the cap of 6 per line, and how it shows at checkout.
---

# Combinations per discount (Pro)

By default two product discounts on the same item compete and the better one wins
([combining-discounts](combining-discounts)). With Pro, **Stacks with** in a
discount's targeting and combinations lets it add up with the discounts you pick.

## How a stack is formed

- **Either side is enough.** If A lists B, A and B stack even when B does not list A.
- **Same kind, same target.** Stacking is between product discounts on the same item,
  or between order discounts. Product, order and shipping discounts already add up.
- **Best for the customer.** When several combinations are possible, Won uses the
  one that saves the customer the most.
- **At most 6 per line.** A stack is chosen among the 6 best discounts for that item
  (or for the order). A discount ranked lower is left out and is reported as
  "another discount is better".
- **Never below zero.** A stack never takes more than the item's price, and margin
  protection still caps it ([margin-protection](margin-protection)).

## How it shows at checkout

A stack reaches checkout as **one** discount that names all its parts. When a stack
contains a code discount, it is given under that code, so Shopify counts the code's
use. With two codes in one stack Shopify shows only one of them as applied; the
other one's value is still included. Try a cart says "applied together with code …".

On very large carts with many stacks, checkout output can hit Shopify's size limit.
A stack may then be given as its top discount only; Try a cart warns about it under
"Checkout may differ".

## On Free

Per-discount combinations are left out and the default rules apply. The setting
stays saved. See [plans-free-vs-pro](plans-free-vs-pro).

Exact cap: [reference/limits](../reference/limits.generated.md).
