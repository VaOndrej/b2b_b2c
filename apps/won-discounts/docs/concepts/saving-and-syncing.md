---
title: Saving and syncing with Shopify
slug: saving-and-syncing
layer: concept
feature: sync
min_plan: free
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-09-30
keywords: [sync, not synced, saved, syncing, sync again, collection, targeting, refresh, too many discounts, delay, propisuje]
summary: Saving stores a discount in Won and writes it to Shopify in the background. Until that finishes checkout runs the previous state; collection changes reach checkout within minutes.
---

# Saving and syncing with Shopify

## Saved is not yet live

Saving stores your change in Won and then **writes it to Shopify** (the sync). Most
syncs finish in seconds; large collections take longer and finish in the background.
Until the sync finishes, **checkout runs the previous state**.

The discount list shows this per discount: "Not synced" while it is waiting or after
a failed sync, "Syncing" while its product targeting is being written. The Overview
shows the last sync and offers **Sync again**. A failed sync is retried when you
open the Overview. All statuses:
[reference/discount-statuses](../reference/discount-statuses.generated.md).

## Collections

A discount on a collection applies to the products in it. When you add or remove a
product in a Shopify collection, checkout knows within minutes. At the latest after
24 hours the targeting is refreshed when the Overview opens; **Refresh targeting**
on the Overview does it now.

If the collections of one discount together hold more products than Won reads in one
sync, the discount does not apply at checkout to those collections. The Overview
names them. Every other discount is synced normally.

## Settings that do not fit

Shopify gives the checkout function a limited amount of settings. A save that would
not fit is refused and nothing is saved ("Too many discounts for the discount
function"). Fewer discounts, codes or margin collections make room. Exact size:
[reference/limits](../reference/limits.generated.md).

## Read-only settings

If a newer version of the app saved your settings, this version shows them read-only
until the update finishes. Nothing you change is saved meanwhile.

## Nothing blocks checkout

If checkout has no valid Won settings, Won discounts do not apply until the next
successful sync. Orders still go through.
