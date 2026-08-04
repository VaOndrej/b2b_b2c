---
title: Customize toast appearance
slug: customize-appearance
layer: task
feature: design
min_plan: pro
status: stable
app_version: MVP2
source: hand-written
generated_from: null
lang: en
updated: 2026-08-04
keywords: [appearance, design, colors, dark mode, animation, customize, how to]
summary: How to change toast colors, animation and layout in the design studio (Pro), with a live preview.
---

# Customize toast appearance

**Design studio is a Pro feature.** On Free, toasts use the neutral default look
(light/dark/system), which cannot be restyled but is fully usable.

## Steps (Pro)

1. Open the **Appearance** admin page.
2. Choose a **theme mode** (system / light / dark / custom). Custom unlocks colors.
3. Adjust radius, width, shadow, density, animation, icon set.
4. Optionally set a **per-event accent** color (e.g. green for "added").
5. Use the **live preview** (and Scenario Lab) to check the result — it renders
   with the same engine as the storefront.
6. Save.

Accepted values for every option:
[reference/config-options](../reference/config-options.generated.md).

## Notes

- Changes are safe: invalid values are ignored and fall back to the default.
- The default look already adapts to the shopper's light/dark preference and to
  reduced-motion — you don't have to configure that.

Related: [appearance-and-branding](../concepts/appearance-and-branding.md).
