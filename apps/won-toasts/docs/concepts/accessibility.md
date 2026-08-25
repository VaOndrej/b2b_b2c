---
title: Accessibility
slug: accessibility
layer: concept
feature: core
min_plan: free
status: stable
app_version: MVP14
source: hand-written
generated_from: null
lang: en
updated: 2026-08-23
keywords: [accessibility, a11y, screen reader, aria, aria-live, keyboard, reduced motion, contrast, wcag, touch target]
summary: What Won Toasts does for screen readers, keyboard users and motion sensitivity — and why none of it is behind Pro.
---

# Accessibility

Accessibility is **quality, not scope**, so every plan gets all of it. Pro never
unlocks an accessibility feature and Free never ships a degraded one.

## Screen readers

Toasts render into an `aria-live` region so a screen reader announces them without
stealing focus. Routine confirmations announce politely; genuinely urgent messages
use the assertive role. The region is a status region, not a dialog — a shopper is
never trapped in it.

## Motion

If the shopper's system asks for reduced motion (`prefers-reduced-motion`), entry
animations are dropped and the toast simply appears. Whatever animation you chose
in the design studio is overridden — the shopper's setting wins.

## Colour scheme

The `system` theme mode follows the shopper's `prefers-color-scheme`, so a toast
does not flash a white card at someone browsing in dark mode.

## Pointer and touch

The close (×) button meets the minimum touch-target size on mobile — this is
verified by a geometry test in the release gate, not just by eye.

## Time to read

Auto-dismiss can be paused on hover, and a toast can be closed manually. If your
messages are long, raise the duration rather than relying on the shopper reading
fast; the setting lives under **Design → Timing & interaction**.

Related: [performance-and-compatibility](performance-and-compatibility),
[appearance-and-branding](appearance-and-branding).
