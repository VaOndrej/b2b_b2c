# won-guard Coaching Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the editor-only `won-contrast-guard` into a reusable `won-guard` coaching engine that runs 4 self-skipping soft-warning checks across all 26 won sections.

**Architecture:** One shared editor-only snippet (`request.design_mode`) reads a section's settings, runs checks, and renders a small non-blocking note box — nothing on the live storefront. compose step 2d (which already injects the contrast guard after each section root) is repointed to `won-guard`. No storefront behaviour change; no per-section config.

**Tech Stack:** Shopify Liquid (Horizon theme), `themes/build/compose.mjs` (Node build), `won-tokens.css`, Shopify Dev MCP `validate_theme`, Playwright smoke specs.

## Global Constraints

- Editor-only: every note is gated behind `request.design_mode`; ZERO output on the live storefront.
- Never blocks saving (display-only markup).
- Every check self-skips when its inputs are absent (`settings.x != blank`) — never a crash, never a false positive on a section that lacks those settings.
- `color_contrast` runs only on literal colour values; threshold `< 3.0`.
- All merchant-facing copy is localized `won.editor.*` in BOTH `en.default.json` and `cs.json`; locale parity must stay 0-missing.
- Reuse the existing `.won-editor-note` style + `won.editor.contrast_warn` key; do not duplicate.
- Wiring is the existing compose-2d mechanism only — no new injection mechanism, no hand-editing 26 sections.
- Verify Liquid via Shopify Dev MCP `validate_theme` (conversationId from `learn_shopify_api(api:"liquid")`). Live editor visibility is NOT storefront-automatable (`request.design_mode` is true only in the admin theme-editor iframe) — confirmed by manual editor check, not Playwright.
- Repo is on `main` with a second agent working concurrently; commits are the operator's call — do not push. Keep edits inside these files.

---

### Task 1: Create the `won-guard` snippet + notes-container style + locale copy

**Files:**
- Create: `themes/won-base/snippets/won-guard.liquid`
- Modify: `themes/won-base/assets/won-tokens.css` (add `.won-editor-notes` container; zero the per-note margin)
- Modify: `themes/won-base/locales/en.default.json` (`won.editor.*`)
- Modify: `themes/won-base/locales/cs.json` (`won.editor.*`)

**Interfaces:**
- Consumes: a section settings object passed as `settings` (ids available after compose 2d injection: `hide_mobile`, `hide_desktop`, `accent_override`, `text_color`, `bg_color`; plus section-native `media_type`, `image`, `image_asset`, `button_label`, `button_link`).
- Produces: `snippets/won-guard.liquid`, rendered as `{% render 'won-guard', settings: <var> %}`. Emits `<div class="won-editor-notes">…</div>` in the editor only, or nothing.

- [ ] **Step 1: Write `snippets/won-guard.liquid`** with exactly this content:

```liquid
{% doc %}
Won merchant coaching layer — editor-only, non-blocking soft warnings. Runs a set
of self-skipping checks over a section's settings and renders a small note box in
the theme editor ONLY (request.design_mode). Never shown to shoppers, never blocks
saving. Wired after each won section root by compose step 2d. Supersedes
won-contrast-guard (that check is folded in here).

@param {object} settings - A section settings object.
@example
{% render 'won-guard', settings: section.settings %}
{% enddoc %}
{%- if request.design_mode -%}
  {%- liquid
    assign s = settings
    assign show_hidden = false
    if s.hide_mobile and s.hide_desktop
      assign show_hidden = true
    endif
    assign show_accent = false
    if s.accent_override != blank
      assign r_accent = s.accent_override | color_contrast: '#ffffff'
      if r_accent < 3.0
        assign show_accent = true
      endif
    endif
    assign show_textbg = false
    if s.text_color != blank and s.bg_color != blank
      assign r_textbg = s.text_color | color_contrast: s.bg_color
      if r_textbg < 3.0
        assign show_textbg = true
      endif
    endif
    assign show_media = false
    if s.media_type == 'image' and s.image == blank and s.image_asset == blank
      assign show_media = true
    endif
    assign show_label = false
    if s.button_label != blank and s.button_link == blank
      assign show_label = true
    endif
    assign show_link = false
    if s.button_link != blank and s.button_label == blank
      assign show_link = true
    endif
    assign any = false
    if show_hidden or show_accent or show_textbg or show_media or show_label or show_link
      assign any = true
    endif
  -%}
  {%- if any -%}
    <div class="won-editor-notes" role="status">
      {%- if show_hidden -%}<p class="won-editor-note">{{ 'won.editor.hidden_all' | t }}</p>{%- endif -%}
      {%- if show_accent -%}<p class="won-editor-note">{{ 'won.editor.contrast_warn' | t }}</p>{%- endif -%}
      {%- if show_textbg -%}<p class="won-editor-note">{{ 'won.editor.contrast_textbg' | t }}</p>{%- endif -%}
      {%- if show_media -%}<p class="won-editor-note">{{ 'won.editor.empty_media' | t }}</p>{%- endif -%}
      {%- if show_label -%}<p class="won-editor-note">{{ 'won.editor.label_no_link' | t }}</p>{%- endif -%}
      {%- if show_link -%}<p class="won-editor-note">{{ 'won.editor.link_no_label' | t }}</p>{%- endif -%}
    </div>
  {%- endif -%}
{%- endif -%}
```

- [ ] **Step 2: Add the container style in `won-tokens.css`.** Find the existing block `/* Editor-only soft contrast warning (won-contrast-guard.liquid). Non-blocking. */` and its `.won-editor-note { … }` rule. Replace the comment line with `/* Editor-only coaching notes (won-guard.liquid). Non-blocking, editor-only. */`, change `.won-editor-note`'s `margin` from `var(--won-space-2) 0 0;` to `0;`, and add immediately after the `.won-editor-note { … }` rule:

```css
.won-editor-notes {
  display: grid;
  gap: var(--won-space-2);
  margin: var(--won-space-2) 0 0;
}
```

- [ ] **Step 3: Add locale keys (en) in `themes/won-base/locales/en.default.json`** — inside the existing `won.editor` object, after `contrast_warn`:

```json
"hidden_all": "This section is hidden on mobile and desktop — it will not appear anywhere.",
"contrast_textbg": "Low contrast between your text and background colors — the text may be hard to read.",
"empty_media": "Media is set to Image but no image is selected — a placeholder will show until you add one.",
"label_no_link": "This button has text but no link — clicking it will do nothing.",
"link_no_label": "There's a link with no button text — the button won't show."
```

- [ ] **Step 4: Add the same keys (cs) in `themes/won-base/locales/cs.json`** — inside `won.editor`, after `contrast_warn`:

```json
"hidden_all": "Tato sekce je skrytá na mobilu i desktopu — nikde se nezobrazí.",
"contrast_textbg": "Nízký kontrast mezi barvou textu a pozadí — text může být špatně čitelný.",
"empty_media": "Médium je nastavené na Obrázek, ale žádný není vybraný — do té doby se zobrazí placeholder.",
"label_no_link": "Tlačítko má text, ale chybí odkaz — kliknutí nic neudělá.",
"link_no_label": "Je tu odkaz bez textu tlačítka — tlačítko se nezobrazí."
```

- [ ] **Step 5: Validate the snippet via MCP.** First get a conversationId: `learn_shopify_api(api:"liquid")`. Then (compose is needed so the snippet lands in a full theme dir — run `node themes/build/compose.mjs horizon` first) call `validate_theme` with `absoluteThemePath: <repo>/themes/dist/horizon-dev` and `filesCreatedOrUpdated: [{path:"snippets/won-guard.liquid"}]`.
Expected: ✅ VALID. If `color_contrast` is flagged invalid, that is the one platform fact to re-check against the MCP docs — fix per its guidance.

- [ ] **Step 6: Verify locale parity.**

Run:
```bash
cd <repo> && node -e '
const fs=require("fs");const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"").replace(/,(\s*[}\]])/g,"$1");
const en=JSON.parse(strip(fs.readFileSync("themes/won-base/locales/en.default.json","utf8"))).won.editor;
const cs=JSON.parse(strip(fs.readFileSync("themes/won-base/locales/cs.json","utf8"))).won.editor;
const ek=Object.keys(en).sort(),ck=Object.keys(cs).sort();
console.log("en.editor:",ek.length,"cs.editor:",ck.length,"equal:",JSON.stringify(ek)===JSON.stringify(ck));
'
```
Expected: `equal: true`, both counts 6.

---

### Task 2: Repoint compose 2d to `won-guard` and remove `won-contrast-guard`

**Files:**
- Modify: `themes/build/compose.mjs` (the contrast-guard wiring block, ~lines 188–197)
- Delete: `themes/won-base/snippets/won-contrast-guard.liquid`

**Interfaces:**
- Consumes: `snippets/won-guard.liquid` from Task 1; the existing `rootTag` capture in step 2d (`rootTag[0]` = the matched root-tag text, `rootTag[1]` = the settings var name).
- Produces: every allow-listed section renders `{% render 'won-guard', settings: <var> %}` once after its root; `won-contrast-guard` no longer exists or is referenced.

- [ ] **Step 1: Edit the wiring block in `compose.mjs`.** Replace the three references so the block reads:

```javascript
  const rootTag = src.match(/render 'won-style-vars', settings: ([\w.]+) %\}"[^>]*>/);
  if (rootTag && !src.includes("render 'won-guard'")) {
    src = src.replace(
      rootTag[0],
      `${rootTag[0]}\n  {% render 'won-guard', settings: ${rootTag[1]} %}`
    );
  } else if (!rootTag) {
    console.warn(`2d: ${name}.liquid root tag not matched — coaching guard not wired`);
  }
```

(Also update the block's leading comment: "Wire the merchant coaching layer (W3b-4/won-guard): an editor-only, non-blocking set of soft warnings rendered right after the section root's opening tag.")

- [ ] **Step 2: Delete the old snippet.**

Run:
```bash
cd <repo> && rm themes/won-base/snippets/won-contrast-guard.liquid && echo removed
```

- [ ] **Step 3: Recompose.**

Run: `cd <repo> && node themes/build/compose.mjs horizon`
Expected: ends with `… 26 sections given the shared style controls …` and no `2d:` warnings.

- [ ] **Step 4: Verify wiring across all 26 + old guard gone.**

Run:
```bash
cd <repo>/themes/dist/horizon-dev && \
g=0; for f in $(ls sections/won-*.liquid | grep -v won-sticky-atc); do c=$(grep -c "render 'won-guard'" "$f"); [ "$c" = "1" ] && g=$((g+1)) || echo "BAD $f ($c)"; done; \
echo "won-guard wired 1x on: $g/26"; \
echo "won-contrast-guard refs left: $(grep -rl won-contrast-guard . | wc -l | tr -d ' ')"; \
ls snippets/won-guard.liquid
```
Expected: `won-guard wired 1x on: 26/26`, `won-contrast-guard refs left: 0`, and the snippet listed.

- [ ] **Step 5: MCP validate two affected sections.** With the Task-1 conversationId, `validate_theme` on `["sections/won-band.liquid","sections/won-announcement-bar.liquid"]` (band has media + buttons; announcement bar has neither → confirms self-skip is still valid Liquid).
Expected: ✅ VALID for both.

---

### Task 3: Committed no-leak spec + live gate + editor spot-check

**Files:**
- Modify: `tests/smoke/customization-layer.spec.ts` (append one test)

**Interfaces:**
- Consumes: the composed dist served by a local `shopify theme dev` (SHOP_URL).
- Produces: a permanent storefront contract that coaching notes never reach shoppers.

- [ ] **Step 1: Append the no-leak test** to `tests/smoke/customization-layer.spec.ts`:

```ts
test('editor coaching never leaks to the live storefront', async ({ page }) => {
  for (const path of ['/', '/products/the-collection-snowboard-hydrogen']) {
    await page.goto(path);
    await page.waitForSelector('main', { state: 'attached' });
    const leaked = await page.locator('.won-editor-note, .won-editor-notes').count();
    expect(leaked, `coaching note leaked on ${path}`).toBe(0);
  }
});
```

- [ ] **Step 2: Serve an isolated dist and run the customization spec.** (Isolated copy avoids racing the other agent's shared dist; use a free port.)

Run:
```bash
cd <repo>; SP=<scratch>; rm -rf "$SP/g"; cp -R themes/dist/horizon-dev "$SP/g"; \
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path "$SP/g" --port 9295 --theme 161463730417 >"$SP/g.log" 2>&1 &
# poll until http 200 on 9295, then:
SHOP_URL=http://127.0.0.1:9295 npx playwright test tests/smoke/customization-layer.spec.ts --reporter=line
```
Expected: all customization-layer tests pass, including `editor coaching never leaks to the live storefront`. (This test is green by design — `request.design_mode` is false on the storefront — and stands as a permanent leak guard.)

- [ ] **Step 3: Full smoke — no regression.**

Run: `SHOP_URL=http://127.0.0.1:9295 npx playwright test tests/smoke/ --reporter=line`
Expected: 0 failed. If anything red, treat as a real regression (see the W3-b regression-log entries: `hidden` attribute, heading weight, range-step upload errors).

- [ ] **Step 4: Editor spot-check (manual / agent-attempted).** With `shopify theme dev` running press **e** (or open `https://b2b-b2c-store-development.myshopify.com/admin/themes/161463730417/editor`). Trigger each note and confirm it shows:
  - won section → Appearance → turn ON both *Hide on mobile* + *Hide on desktop* → "hidden everywhere" note.
  - Appearance → *Accent color* `#ffe600` → contrast note. Set *Background color* + *Text color* to two similar colours → text/bg contrast note.
  - won-band → Media → type *Image*, pick none → empty-media note.
  - won-band → button label set, link empty → label-without-link note.
  Confirm none block saving.

- [ ] **Step 5: Stop the isolated server** (`lsof -ti tcp:9295 | xargs kill -9`) to free the shared dev theme for the other agent.

- [ ] **Step 6: Memory.** Append one line to `.agents/memory/theme-map.md` (2d note: "`won-guard` = editor-only coaching engine, supersedes won-contrast-guard, wired after each section root; 4 self-skipping checks") and a short `SOURCE/memory/decisions.md` entry (coaching layer = editor-only, non-blocking, self-skipping; metafield-empty deliberately NOT warned — intentional-empty is legitimate).

---

## Notes for the executor

- The 4 checks share one snippet + one compose line on purpose (they're one deliverable); do not split into per-section edits.
- Do NOT reintroduce a metafield-empty warning — see the spec's non-goals (water-bottle-vs-supplement).
- If `color_contrast` behaves unexpectedly, it is the single platform fact to verify against the Shopify Dev MCP, not to guess.
