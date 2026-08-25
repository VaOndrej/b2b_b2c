---
title: Anti-spam and how often toasts appear
slug: anti-spam-and-frequency
layer: concept
feature: design
min_plan: free
status: stable
app_version: MVP8
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [anti-spam, frequency, cap, cooldown, quiet mode, merge, rate limit, too many toasts, dismiss]
summary: How Won Toasts prevents flooding a shopper — merge, caps, cooldowns and quiet mode — and which parts are Free versus Pro.
---

# Anti-spam and how often toasts appear

Found in the admin under **Design → Anti-spam**. Three layers, applied in order.

## 1. Merge — several changes become one toast

Rapid changes collapse into a single toast instead of a stack. You control what
counts as "the same thing" (**Group by**), how wide the merge window is
(**Merge changes within**), and whether quantity changes fold into one `+N`
(**Merge quantity changes into one "+N"**).

Note that adding the same product three times fast already produces **one** toast
with `+3` — that is the cart diff, not merging. Merging is for *different*
products or event types arriving together. See
[grouping-and-conflicts](grouping-and-conflicts).

## 2. Cap — how much is too much

- **Max toasts per session** — the hard ceiling per shopper visit.
- **Wait between repeats** — a cooldown before the same rule may fire again.
- **Hide a dismissed toast for** — if a shopper closes something, it stays gone.
- **Advanced (Pro):** max toasts per minute, and ignoring duplicates within a window.

**Free is capped too.** Free is held to a fixed per-session ceiling it cannot
raise (see [reference/plan-limits](../reference/plan-limits.generated.md) for the
number). Pro does not buy "protection" — protection is quality and every plan gets
it. Pro buys **control of the number**, including raising it or setting `0` for
unlimited.

## 3. Quiet — mute everything

**Quiet mode** silences every toast until it expires. Use it during a migration,
a theme edit or a campaign you don't want commented on.

## What this means when you debug

A toast that "should" have fired and didn't is usually governed, not broken. The
order of suppression reasons the engine records is: quiet mode → session cap →
cooldown → suppressed after dismiss. See
[troubleshooting](../support/troubleshooting).

Related: [grouping-and-conflicts](grouping-and-conflicts),
[notifications-and-recipes](notifications-and-recipes).
