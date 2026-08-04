---
title: Configure targeting
slug: configure-targeting
layer: task
feature: targeting
min_plan: pro
status: stable
app_version: MVP5
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [targeting, page, device, mobile, customer, setup, how to, pro]
summary: How to restrict where toasts appear by page, device, or customer state (Pro).
---

# Configure targeting

**Targeting is a Pro feature.** On Free, toasts show everywhere and the targeting
settings are ignored.

## Steps (Pro)

1. Open the **Targeting** admin page.
2. Pick **page types** to allow (leave empty to show on all pages).
3. Choose a **device** filter (both / mobile / desktop).
4. Choose a **customer state** filter (both / guests / logged-in).
5. Save.

Accepted values: [reference/config-options](../reference/config-options.generated.md).

## Notes

- Targeting is enforced server-side, so it applies before toasts reach the browser.
- **Customer state** is only applied when the storefront can tell whether the
  shopper is logged in; when it can't, toasts show rather than guessing.

Related: [targeting](../concepts/targeting.md).
