---
title: Grouping, anti-spam and conflicts
slug: grouping-and-conflicts
layer: concept
feature: grouping
min_plan: free
status: stable
app_version: MVP3
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [grouping, anti-spam, rate limit, dedupe, summary, overflow, conflict]
summary: How Won Toasts avoids toast spam by grouping bursts, deduping, rate-limiting, and summarizing multiple milestones.
---

# Grouping, anti-spam and conflicts

Won Toasts keeps notifications calm even when a lot happens at once.

## Net change, not per-click

Repeated changes to the **same product** collapse into their net result before a
toast is ever shown — three quick adds become one `+3` toast. This happens at the
cart-reconcile level, so it's automatic.

## Grouping across different products

When several **different** products or types change in one burst, grouping decides
how they combine:

- **off** — one toast per change
- **by-product** / **by-variant** — merge changes to the same product/variant
- **by-type** — merge by event type (all "added" together, etc.)

Merged toasts sum their deltas. The accepted values are in
[reference/config-options](../reference/config-options.generated.md).

## Anti-spam guardrails

- **Dedupe window** — suppresses an identical toast fired again within a short window.
- **Rate limit** — caps how many toasts appear per minute (a sliding 60s window).
- **Overflow** — when more toasts arrive than the max-visible limit, they either
  **queue** or **collapse** into a "+N more" chip.

## Conflicts and summaries

When multiple things qualify at the same time, toasts are ordered by **severity**
(warning → reward → success → info) and priority. If **two or more reward
milestones** fire together, they collapse into a **single summary toast** instead
of stacking — so the shopper sees one clear message, not a pile.

Related: [cart-toasts](cart-toasts), [milestones](milestones).
