---
title: Show your own announcement
slug: create-an-announcement
layer: task
feature: notifications
min_plan: free
status: stable
app_version: MVP11
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [announcement, banner, message, sale, shipping cutoff, campaign, ab test, variants]
summary: Put your own message on the storefront without touching the theme, optionally split-tested across variants.
---

# Show your own announcement

Use this for a sale, a shipping cutoff, a holiday note — anything you would
otherwise hard-code into the theme.

1. Go to **Toasts** → **Announcement**.
2. Turn on **Show an announcement**.
3. Write the **Message**. Example: *Free gift on orders over 1000 Kč this week!*
4. Save.

## Translate it

An announcement carries a message per language. Fill the other languages under
**Markets → Translations**; a shopper on a language you left blank falls back to
your default language rather than seeing nothing. See
[translate-toast-messages](translate-toast-messages).

## Split-test it (optional)

Put several lines into **A/B variants (one per line)** and shoppers are split
evenly between them. The assignment is stable per shopper, so nobody watches the
message change mid-visit. Results appear under **Insights** (Pro) — see
[insights-and-roi](../concepts/insights-and-roi).

## It still obeys the caps

An announcement is governed like every other recipe: session cap, cooldown, and
"stays hidden after a shopper dismisses it". If yours shows less often than you
expect, check **Design → Anti-spam** — see [tune-anti-spam](tune-anti-spam).
