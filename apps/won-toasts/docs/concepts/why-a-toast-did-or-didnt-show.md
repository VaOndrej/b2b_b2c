---
title: Why a toast did or didn't show
slug: why-a-toast-did-or-didnt-show
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [not showing, why, missing toast, suppressed, order, pipeline, decision, debug, silent]
summary: The exact order of checks a toast passes before it renders, so you can tell which one silenced it.
---

# Why a toast did or didn't show

Most "it's broken" reports are a toast that was **decided against**, not one that
failed. The checks run in a fixed order, and the first one that says no wins.

## The order

1. **Is the app on?** The toggle on the app **Home** page.
2. **Is the app embed enabled?** In the theme editor. Without it nothing loads at
   all — no script, no toast. See [turn-on-won-toasts](../tasks/turn-on-won-toasts).
3. **Is this page excluded?** A URL in *Run everywhere, except…* suppresses the
   app completely on that page.
4. **Does targeting match?** *(Pro)* Page type, device and customer state must all
   match, or the app stays inactive for this visitor.
5. **Quiet mode?** If on, everything is muted until it expires.
6. **Is the recipe on?** Cart toasts, countdown, announcement and the Pro recipes
   each have their own switch.
7. **Merging.** Several changes arriving together become one toast — so a "missing"
   toast is often folded into the one you did see, with a `+N`.
8. **Rate limit and caps.** Per-minute rate limit, per-session cap, per-rule
   cooldown, and "stays hidden after the shopper dismissed it".
9. **Does the data support it?** Low stock stays silent above your threshold, cart
   activity stays silent without real activity, a countdown stops after its end
   date. See [notifications-and-recipes](notifications-and-recipes).
10. **Render.** Only now does the shopper see anything.

## Reading it in the other direction

- **Nothing at all on any page** → steps 1–3.
- **Nothing for some visitors only** → step 4 (targeting) or a holdout group.
- **Fewer toasts than expected** → steps 5–8, in that order.
- **One toast instead of three** → step 7. This is working as intended.
- **A social-proof recipe never speaks** → step 9. Also intended.

## What is never the cause

The app does not silently drop a toast because of an error in your settings. An
invalid value falls back to its default and the rest keeps working — a broken
number can make a toast *different*, never randomly absent.

Related: [anti-spam-and-frequency](anti-spam-and-frequency),
[troubleshooting](../support/troubleshooting.md).
