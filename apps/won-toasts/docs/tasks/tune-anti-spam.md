---
title: Show fewer toasts (anti-spam tuning)
slug: tune-anti-spam
layer: task
feature: design
min_plan: free
status: stable
app_version: MVP8
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [too many toasts, spam, annoying, frequency, cap, cooldown, quiet mode, merge, rate limit]
summary: The order to work through when toasts feel too frequent — merge first, then caps, then quiet mode.
---

# Show fewer toasts (anti-spam tuning)

All of it lives under **Design → Anti-spam**. Work top-down; each layer is
cheaper than the one below it.

## 1. Merge first

- **Group by** — widen it (e.g. group by product rather than variant) and several
  changes become one toast.
- **Merge changes within** — a longer window catches more of a burst.
- **Merge quantity changes into one "+N"** — on.

Merging keeps the information and removes the stack, so try it before capping.

## 2. Then cap

- **Max toasts per session** — the ceiling per visit.
- **Wait between repeats** — a cooldown before the same toast may return.
- **Hide a dismissed toast for** — respect a shopper who closed it.
- **Advanced caps** *(Pro)* — max per minute, and ignoring duplicates within a window.

On Free the per-session cap is a fixed number you cannot raise; Pro lets you set
it, including `0` for unlimited. See
[reference/plan-limits](../reference/plan-limits.generated.md).

## 3. Quiet mode when you need silence

**Quiet mode** mutes everything — useful during a theme migration or a campaign
you don't want commented on. Remember to switch it back off.

## Also check what's on

Fewer toasts sometimes just means fewer recipes. **Toasts** shows every recipe
with its on/off state; turning one off is the bluntest and clearest fix.

Related: [anti-spam-and-frequency](../concepts/anti-spam-and-frequency),
[grouping-and-conflicts](../concepts/grouping-and-conflicts).
