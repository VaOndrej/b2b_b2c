---
title: Turn toasts off on specific pages
slug: exclude-pages-and-urls
layer: task
feature: targeting
min_plan: free
status: stable
app_version: MVP10
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [exclude, exclusion, url, checkout, landing page, disable on page, targeting, wildcard]
summary: Keep toasts off checkout, legal pages or a specific campaign landing page using URL exclusions.
---

# Turn toasts off on specific pages

Exclusions are on the **Targeting** page under **Run everywhere, except…** — and
unlike targeting itself, they are available on every plan.

1. Go to **Targeting**.
2. Under **Specific URLs**, list the paths to stay off, one per line:

   ```
   /checkout*
   /pages/legal
   ```

3. `*` matches the rest of the path, so `/checkout*` covers every checkout step.
4. Save.

## Exclusion beats everything else

If a page is excluded, nothing renders there — not cart toasts, not an
announcement, not a countdown. It is the reliable way to guarantee a clean page.

## Narrowing instead of excluding (Pro)

To *choose* where toasts run rather than carve pages out, use **Narrow it down** —
page type, **Devices**, **Customers**. That part is Pro. See
[configure-targeting](configure-targeting).

Related: [targeting](../concepts/targeting).
