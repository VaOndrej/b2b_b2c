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

Each discount in the list shows one status. Only **Live** and
**Syncing** mean it applies at checkout right now.

| Status (EN) | Status (CS) | What it means |
|---|---|---|
| Live | Běží | Switched on, inside its dates, and this version is in Shopify: it applies at checkout. |
| Off | Vypnuto | Switched off. It does not apply. |
| Scheduled | Naplánováno | Scheduled from ‹date› |
| Ended | Skončilo | Ended ‹date› |
| Unsaved | Neuloženo | Not saved yet |
| Not synced | Nepropsáno | Saved, not written to Shopify yet |
| Not synced | Nepropsáno | Not in Shopify: the sync failed. Details and Sync again are on the Overview. |
| Syncing | Propisuje se | Running, but its product targeting is being written to Shopify right now. New products get the discount within minutes. |
| Not running | Neběží | Not running: this code discount has no code yet |
| Not running | Neběží | Not running: no products or collections are picked. |
| Not running | Neběží | Not running: it has no value in any of the store's currencies. |
| Not running | Neběží | Not running: it targets only markets that are switched off in Won. |
| Not running | Neběží | Not running: it uses a Pro feature your plan does not run at checkout. |
| Not running | Neběží | Not running: segment targeting isn't applied at checkout yet |
