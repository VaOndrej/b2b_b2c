---
title: Undo a move
slug: undo-a-move
layer: task
feature: native-discounts
min_plan: free
status: stable
app_version: MVP1
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [undo, restore, put back, shopify discount, uninstall, revert move]
summary: Put a moved discount back into Shopify from Won's backup, and why to do it before uninstalling the app.
---

# Undo a move

1. Open the **Overview** and find the discount under **Moved to Won**.
2. Click **Undo** and read **What changes**.
3. Confirm. Won removes its discount, checks that Shopify no longer runs it, and
   creates the discount in Shopify again from the backup.

## What changes

The discount comes back as a **new** Shopify discount: a new ID, the usage count from
zero, and the usage limit set to the uses that were left. Changes you made to the Won
discount after the move are lost; the backup is the discount as it was before the
move.

## Before uninstalling Won

Moved discounts run through Won and stop working when the app is uninstalled. Undo
every move first.

Background: [../concepts/moving-native-discounts.md](../concepts/moving-native-discounts.md).
