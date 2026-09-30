---
title: Codes vs automatic discounts
slug: codes-vs-automatic-discounts
layer: concept
feature: discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [code, discount code, automatic, coupon, usage limit, once per customer, code limit, 20 code discounts, 25 discount functions, kódem, automaticky]
summary: Automatic discounts apply by themselves; code discounts apply when a customer enters one of their codes. How codes behave and why active code discounts are limited.
---

# Codes vs automatic discounts

Every discount in **Discounts & codes** applies either **Automatically** or **With a
code**. Both follow the same combining rules
([combining-discounts](combining-discounts)).

## Automatic discounts

An automatic discount applies whenever its conditions are met. All automatic Won
discounts run inside one Shopify discount, so you can have many of them. They have
no usage limits.

## Code discounts

- A code discount applies only when the customer enters one of its codes at checkout.
- One code discount can hold many codes (one per influencer, one per newsletter).
  They share the value and conditions.
- Codes of the **same** discount never add up: one of them applies per cart. Codes
  of **different** discounts can apply together if the combining rules allow it.
- Codes are not case-sensitive. A code can belong to one discount only, in Won and
  in Shopify. Shopify refuses a code that another discount already uses, even an
  ended one.
- Only code discounts have usage limits: total uses and once per customer. Shopify
  counts the uses.
- Rarely, two codes cannot be used together because checkout cannot tell them
  apart. The admin refuses the save; change one code, for example add a character.

## Why active code discounts are limited

Each active code discount is its own discount function in Shopify, and Shopify runs
a limited number of discount functions per store (other apps count too). Won
therefore caps how many code discounts can be active at once. A scheduled code
discount counts as active. To offer more codes, add them to an existing code
discount instead of creating a new one.

Exact numbers: [reference/limits](../reference/limits.generated.md).

## Which to use

- **Automatic** for store-wide sales, collection sales and free shipping above an
  amount.
- **Code** for welcome and newsletter codes, influencers, customer service and
  anything that should reach only some customers.

How-to: [../tasks/create-an-automatic-discount.md](../tasks/create-an-automatic-discount.md),
[../tasks/create-a-discount-code.md](../tasks/create-a-discount-code.md).
