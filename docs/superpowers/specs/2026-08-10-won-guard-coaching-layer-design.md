# won-guard — merchant coaching layer (editor-only)

**Date:** 2026-08-10
**Status:** approved (design), pending implementation plan
**Context:** extends the W3-b Universal Customization Layer. Generalises the
`won-contrast-guard` soft-warning idea into a reusable, editor-only coaching
engine across all 26 won sections.

## Goal

The theme actively coaches the merchant in the theme editor: when a setting
combination is likely a mistake, show a small **non-blocking** note explaining
what will happen and how to fix it. Never shown to shoppers, never blocks save.
Sellable framing: "the theme guides you."

## Non-goals / explicitly dropped

- **Metafield-empty warning is NOT built.** Empty metafields are frequently
  intentional (a water bottle has no nutrition table; a supplement does). The
  storefront already renders nothing for an empty table (`mode == 'none'`), and
  `won-nutrition-table` / `won-param-table` already show an editor guide card for
  `source == 'metafield'` + empty. That existing behaviour stays unchanged.
- No storefront behaviour change of any kind. No blocking validation.
- No per-section bespoke config.

## Architecture

Generalise `snippets/won-contrast-guard.liquid` → **`snippets/won-guard.liquid`**:
a single shared snippet, editor-only (`request.design_mode`), non-blocking. It
receives `settings`, runs an ordered list of checks, and emits ONE
`<div class="won-editor-notes">` containing a `<p class="won-editor-note">` per
detected issue. Emits nothing when there are no issues or when not in the editor.

**Wiring (no new mechanism):** compose step 2d already injects
`{% render 'won-contrast-guard', settings: <var> %}` right after each won section
root, capturing the section's settings var. Change that single string to
`won-guard`. All 26 sections are covered automatically; `won-sticky-atc` stays
excluded (as today).

**Each check self-skips** when its inputs are absent on the section, so a section
that has no media / no button / no colour pickers simply produces no note for
those checks — never a dead or false-positive warning.

## Checks (v1)

1. **Hidden everywhere** — `hide_mobile` AND `hide_desktop` both true.
   → "This section is hidden on mobile and desktop — it will not appear anywhere."
   Applies to all 26 (every section gets `hide_*` from the fragment).
2. **Low contrast** (extends today's check):
   - accent (`accent_override`) vs white button text — as today.
   - if BOTH `text_color` and `bg_color` are set → their mutual contrast.
   Only literal colour pairs are checked. When only one of text/bg is set (an
   override vs the colour scheme), contrast is NOT computed — the scheme colour is
   a runtime `--color-*` var, not a Liquid literal. Documented limitation.
   Threshold: `color_contrast < 3.0` (soft, same as today).
3. **Empty media** — a media control is on but no image chosen
   (`media_type == 'image'` with no `image`/`image_asset`, or an image setting
   present but blank). → "Media is on but no image is selected — a placeholder
   will show until you add one." Applies to the ~5–6 sections with media settings.
4. **Label ↔ link** — `button_label` set with empty `button_link`, or a link set
   with empty label. → "This button has text but no link" / "A link with no button
   text will not show." Applies to sections with button settings.

## Data flow

compose 2d → `{% render 'won-guard', settings: <sectionSettingsVar> %}` after the
root tag → snippet reads `settings.*`, runs checks, emits notes. No template or
settings_data changes. Reuses the existing `.won-editor-note` style; adds a
`.won-editor-notes` container.

## Error handling / safety

- Gated on `request.design_mode` — zero output on the live storefront.
- Never blocks saving (it is display-only markup).
- Every check guards its inputs (`settings.x != blank`) → a missing setting is a
  skip, never a crash.
- `color_contrast` only on literal hex/rgb values the merchant picked.

## Testing

- **Committed Playwright spec:** assert the coach NEVER leaks to shoppers — no
  `.won-editor-note` / `.won-editor-notes` on the live storefront (home + PDP).
  This is the storefront-facing contract that IS automatable.
- **MCP `validate_theme`** on `won-guard.liquid` + a couple of affected sections.
- **Editor visibility is NOT storefront-automatable:** `request.design_mode` is
  true only inside the admin theme editor iframe, not on `theme dev`. Visual
  confirmation of each note showing is a manual editor check (see handoff below),
  which the author will perform; the agent may also attempt it via the editor URL.

### Editor check handoff (exact locations)

With `shopify theme dev` running, press **e** to open the theme editor (or open
`https://<store>/admin/themes/<id>/editor`). Then, to trigger each note:
- **Hidden everywhere:** any won section → Appearance → turn ON both *Hide on
  mobile* and *Hide on desktop*.
- **Low contrast:** any won section → Appearance → set *Accent color* to a pale
  colour (e.g. `#ffe600`); or set *Background color* and *Text color* to two
  similar colours.
- **Empty media:** a won-band → Media → set type to *Image* but pick no image.
- **Label ↔ link:** a won-band → set a button label but leave the button link
  empty.

## Rollout

Single slice — the engine + 4 checks ship together (they share the snippet and
the one-line compose wiring). Copy is human, en + cs, locale parity enforced.
