---
title: Moving Shopify discounts into Won
slug: moving-native-discounts
layer: concept
feature: native-discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [move, migrate, import, shopify discount, what is lost, usage count, once per customer, undo, uninstall, backup, přesun]
summary: What happens when a Shopify discount is moved into Won, what is lost (usage count, once-per-customer history), what Undo restores and why to undo before uninstalling.
---

# Moving Shopify discounts into Won

Moving turns a Shopify discount into a Won discount with the same value, target,
minimum, dates, codes and limits, so the engine counts it with the rest. The dialog
before the move lists exactly what changes for that discount.

## What happens

Won always **backs up** the original first. Then:

- **Automatic discount:** Won creates the same discount, syncs it to Shopify and
  checks it applies, then deletes the Shopify original (its ID too). For a moment both
  may apply. If the delete fails, Won takes its copy out again.
- **Code discount:** Won deletes the Shopify original first, because Shopify never
  lets two discounts share a code, not even an ended one. Then it creates the Won
  discount and syncs it. For a short moment (seconds, minutes for large collections)
  the code does not apply.

## What you lose

- **The usage count** stays with the deleted Shopify discount. Won counts from zero;
  a total usage limit is set to the uses that were left. Orders still show the
  original discount.
- **"Once per customer" starts over.** A customer who already used the code can use
  it once more.
- Codes beyond what one Won discount holds stop working.
- A limit to the first N subscription orders is not kept: the discount applies to
  every order.

## Keep in mind

- A Shopify amount exists in the shop currency only. Add it for your other
  currencies, or the discount is not offered there. See
  [markets-and-currencies](markets-and-currencies).
- Combining can change: after the move the discount follows Won's rules
  ([combining-discounts](combining-discounts)).
- Won switches automatic discounts by whole days in the shop's time zone, so an
  automatic discount's start time becomes midnight and its end time the end of that
  day.
- The minimum keeps Shopify's rule: it counts only the selected products.
- Won does not tell subscriptions apart; the discount applies to them too.

## Undo

Undo puts the discount back into Shopify from the backup. It comes back as a **new**
discount: a new ID, the usage count from zero and the usage limit set to the uses
left. Changes made to the Won discount after the move are lost. Steps:
[../tasks/undo-a-move.md](../tasks/undo-a-move.md).

## Before uninstalling

Moved discounts run through Won. If you uninstall the app, they stop working. Put
them back with Undo before uninstalling.
