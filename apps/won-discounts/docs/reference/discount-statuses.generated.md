---
title: Discount statuses
slug: discount-statuses
layer: reference
feature: discounts
min_plan: free
status: stable
config_version: 1
source: generated
generated_from: '@won/core/discounts'
lang: en
keywords: [status, live, not running, not synced, scheduled, ended, běží, neběží, nepropsáno]
summary: Every status a Won discount can show in the admin (English and Czech label) and what it means.
---

<!-- AUTO-GENERATED from @won/core/discounts and the won-discounts admin copy — DO NOT EDIT. Run `npm run docs:gen -w won-discounts` to refresh. -->

# Discount statuses

Each discount in the list shows one status. Only **Active** and
**Syncing** mean it applies at checkout right now.

| Status (EN) | Status (CS) | What it means |
|---|---|---|
| Active | Aktivní | Switched on, inside its dates, and this version is in Shopify: it applies at checkout. |
| Off | Vypnuto | Switched off. It does not apply. |
| Scheduled | Naplánováno | Scheduled from ‹date› |
| Ended | Skončilo | Ended ‹date› |
| Unsaved | Neuloženo | Not saved yet |
| Not synced | Zatím neplatí | Saved, not written to Shopify yet |
| Not synced | Zatím neplatí | Not in Shopify: the sync failed. |
| Syncing | Propisuje se | Running, but its product targeting is being written to Shopify right now. New products get the discount within minutes. |
| Inactive | Neaktivní | Inactive: this code discount has no code yet |
| Inactive | Neaktivní | Inactive: no products or collections are picked. |
| Inactive | Neaktivní | Inactive: it has no value in any of the store's currencies. |
| Inactive | Neaktivní | Inactive: it targets only markets that are switched off in Won. |
| Inactive | Neaktivní | Inactive: it uses a Pro feature your plan does not run at checkout. |
| Inactive | Neaktivní | Inactive: segment targeting isn't applied at checkout yet |
