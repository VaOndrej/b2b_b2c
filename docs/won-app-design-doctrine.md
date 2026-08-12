# Won App Design Doctrine

**Shared design knowledge for every `won-*` app.** This is the canonical home for
the numbered doctrine (`§2`–`§8`) that the Won Toasts codebase already cites in
comments, plus the cross-cutting architecture decisions we make as we build. It
is written to apply **globally** to all Won apps at design time — a new app
cloned from `apps/_template` inherits these rules, so merchants meet one coherent
system across the whole portfolio.

> **How to use.** When designing or reviewing any `won-*` app surface, cite the
> section (`doctrine §7b`) in code comments and PRs, exactly as Won Toasts does.
> If a decision here proves wrong for a specific app, change it *here* and note
> the exception — don't fork the doctrine silently.

Related: [Won portfolio boundaries](product-roadmap.html) (one app = one
primitive), [nova-aplikace.md](nova-aplikace.md) (new-app procedure).

---

## The principles (§1–§8)

### §1 — Preview-first
Every merchant-editable surface shows a **live preview** of the real result, not
an abstract form. If a setting changes what shoppers see, the merchant must see
that change *before* saving. No "save and go look at your store to find out."

### §2 — The preview reflects what they're typing
The preview binds to **native `input`/`change` events** and re-reads the form on
every keystroke. (Polaris `s-*` web components don't fire React `onInput`/
`onChange`, so a React-only binding leaves the preview frozen — always bind to
the DOM form ref.) Typing a message updates the preview live.

### §3 — One honest scene that exercises every dimension
- The preview shows **one representative scene** — no scenario switcher. That one
  scene must exercise **every editable dimension**, so nothing the merchant tunes
  is invisible (e.g. show every accent colour they can edit at once).
- **§3c** — *every* storefront-affecting control moves the preview.
- **§3e** — offer an **animated** preview (enter/stay/leave, real timing &
  stacking), not only a static image.
- **§3f** — metrics render as **charts + colour**, never a bare number wall.
- **§3g** — Pro-gated blocks carry a **consistent visual marker** (the Won amber
  `ProFrame`), so "this is Pro" reads at a glance on every page and every app.
- **§3i** — a preview must never become an **endless scroll**; cap and clamp it.
- **§3k** — live **custom CSS** is injected into the preview scope so the merchant
  never edits blind. Document the stable hooks (`[data-won-toast]`, `[data-type]`).

### §4 — Human copy, never raw machine values
- Merchants insert dynamic values via **clickable token chips** (`{count}`,
  `{name}`), never by hand-typing tokens.
- Time and money are entered in **human units** (seconds, minutes, currency) and
  converted internally.
- **§4b** — destructive changes are recoverable via **version history + one-click
  rollback**, not a raw-JSON backup.
- **§4c** — **no raw enum key** ever renders in the UI. `top-right`, feature keys,
  event types all get human labels. Nothing in the admin shows an internal string.

### §5 — Real data, honest on empty
Won apps show **real data or nothing**. Real inventory, real orders, real
counters — never fabricated social proof. On an empty store the app is honest
(shows zero / hides the claim), and time-based claims (countdowns) are truthful.
This is a trust primitive and a legal one; it is non-negotiable.

### §6 — Visual grouping carries meaning
Spacing and grouping are semantic. A control that belongs to a group sits *in*
that group; nothing floats "glued" to a neighbouring block it doesn't belong to.

### §7 — Shallow, task-based IA
- Collapse settings into a few **task-based destinations**, not a deep tree.
  (Won Toasts: Appearance+Behavior→**Design**; Recipes+Events→**Toasts**;
  Exclusions→**Targeting**; Frequency groups folded in.)
- **§7b** — the **studio shell**: one shared picker (`SegmentedNav`/launcher) +
  one focused panel at a time + a sticky live preview. The same shape on every
  config page and every app, so the merchant learns a single layout once.
- **§7c** — configure a thing **where it lives**: related settings unify on one
  page. The **primary** controls are visible first-class blocks; **rare/advanced**
  controls stay first-class but **collapsed by frequency-of-use** (see §9) — not
  scattered across tabs, not deleted, not all forced open at once.

### §8 — Structure over a wall of fields
No flat wall of inputs. Complex config gets a **purpose-built layout**.
- **§8b** — an N×M relationship (e.g. events × languages) renders as a **grid/
  matrix**, not a flat list. Hidden fields still submit; collapsing affects only
  visibility.

### §9 — Simple surface, deep underneath (progressive disclosure by frequency)
Depth is the product's moat — but it must be **opt-in, never the default view**.
A config screen must read as **short and calm on first paint**; power lives one
click away. This is the same promise the storefront makes to shoppers ("don't
overwhelm"), turned on the merchant. It **tempers §7c**: first-class ≠ always-open.

- **§9a — Rank by frequency, not by schema.** Show the ~20% of controls the ~80%
  of merchants touch (is it on? what does it say? one preset look). Collapse the
  rest (per-event colours, shape/motion, per-currency thresholds, wording
  overrides, custom CSS) behind a labelled disclosure. Giving every schema field
  its own always-visible control is the engineer-out failure mode.
- **§9b — Every collapsed block ships a strong default.** The merchant who never
  opens it still gets a good result. Defaults are what make hiding safe.
- **§9c — Repetition IS overwhelm.** N near-identical fields (6 accent pickers, 6
  blank currency rows, 4 wording fields) read as a wall even when each is simple.
  Collapse them, or lazy-add ("Add currency" → one row at a time), rather than
  pre-rendering N empties.
- **§9d — The disclosure summary tells the truth.** A collapsed block states its
  state ("inherits global" / "customised", "1 currency set") so nothing important
  is invisible — only quiet.

### §10 — Effect Proof (show the mechanism, don't describe it)
Where a setting has a **non-obvious consequence**, glue a tiny inline **Without → With**
illustration to it, drawn from a **faithful mock of the same primitive the shopper
sees** (for Toasts: the toast chip). The merchant should *see* what the control does,
not read a paragraph and imagine it. This is §1 (preview-first) applied to a single
control instead of the whole config — the proof lives at the point of decision, not
in a distant preview panel.

- **§10a — Show the mechanism, not a description.** Prose says "groups rapid changes";
  the proof shows `▪▪▪▪ → ▪ +4`. One glance replaces a sentence and a mental model.
- **§10b — The proof must be TRUE to the runtime.** Fake-but-honest: the numbers/behaviour
  must match what the engine actually does (e.g. the Cap proof mirrors the storefront's
  `maxPerSession` gate, "0 = no limit"). A proof that lies is worse than no proof.
  Put the shared arithmetic in the engine/core so admin and runtime can't drift.
- **§10c — Reactive where the effect is value-dependent.** If the consequence changes
  with the value (a cap of 3 vs 10, group-by Product vs Type), the proof updates live
  as the merchant edits — otherwise it's static.
- **§10d — Only where the consequence is non-obvious.** A proof on a trivial on/off
  (a colour, "show border") is noise and violates §9. Reserve it for the settings a
  merchant would otherwise get wrong or not understand (merge, grouping, caps, muting).
- **§10e — One shared primitive, not per-setting one-offs.** A single `EffectProof`
  frame + chip primitive keeps every proof visually identical and cheap to add, so the
  pattern spreads without fragmenting.

### §11 — One meaning, one colour (consistent, non-overloaded semantics)
Each visual code carries **exactly one meaning**, and that meaning looks the **same
everywhere**. A merchant learns the language once. The moment two different meanings
share a colour — or one meaning is drawn two slightly different ways — the interface
stops being legible.

- **§11a — The three codes are orthogonal and must never collide.** In the Won suite:
  **blue = selected/active** (which card/tab am I on), **amber = Pro/plan** (see A2 +
  brand token), **green = live/on** (is this running). "Selected" is not "on" is not
  "premium" — three questions, three colours, never overloaded. Adding a fourth meaning
  means a fourth deliberate code, not reusing an existing one.
- **§11b — One selection affordance, one source.** Every picker (preset looks, the
  Toasts launcher, tabs) highlights the chosen item the *same* way — the blue ring.
  It lives in **one shared helper** (`selectionRing()` / `WON_SELECT`), never re-typed
  per card, so it can't drift into N almost-identical copies (the exact bug that seeded
  this rule: two pickers at `2px`/`1.5px`, shadow `.16`/`.14`). Same lesson as §10b:
  shared code is the only guarantee of visual truth.
- **§11c — Same meaning, pattern may differ by control type.** A card grid and a
  segmented tab bar are different *patterns*; they may render selection differently
  (a ring vs. a raised pill), but both draw from the **same selection colour**. Unify
  the token, not necessarily the whole shape.
- **§11d — State is legible at rest.** Selected / on / Pro must be readable **without
  interacting** — a word ("On"/"Off"), a coloured dot, the ring — never inferred from
  what's missing. The merchant should never click to find out the current state.

### §12 — Honest by construction (never fabricate what looks like proof)
Anything that *reads to a shopper as a fact about the store* — social proof, scarcity,
countdowns, "N people bought this", "only N left" — must trace to **real store data or
not render at all**. This is both the suite's soul and a hard Shopify survival rule:
fake urgency is a dark pattern that gets apps rejected and burns the merchant's trust
with their own customers. Honesty is a **property of the architecture**, not a setting
the merchant could switch off.

- **§12a — No data, no component.** A feature that has nothing real to show hides
  itself; it never invents a plausible number. Won's social-proof feed only turns on
  once real orders cross a threshold (`coldStartReady(orderCount, minOrders)`), and it
  stores only a real first name + city + product title from an actual order — never a
  synthesised persona.
- **§12b — Every claim is traceable.** "N orders this week", "only N left" read from
  real order/inventory counts. If you can't point at the row that makes a claim true,
  the claim doesn't ship. Auto-promotion of an A/B winner fires only on a *measurable*
  engagement win, "never fabricated" (guardrail service).
- **§12c — The merchant can't turn honesty off.** There is no "make the counter look
  bigger" toggle. Copy can be edited (§4), the underlying fact cannot be faked. Design
  the data path so a dishonest state is *unrepresentable*, not merely discouraged.

### §13 — Never dead-end — link to the fix
Any screen that **diagnoses, blocks, or demands an action** must carry the merchant to
the **exact control** that resolves it — a deep link, not "go to settings and look".
The merchant should never have to hunt for where a problem is fixed.

- **§13a — Diagnosis ships its own fix link.** Won's Insights doesn't say "check your
  triggers"; each diagnosis carries an `action: { label, href }` that lands on the
  precise control ("Fix targeting" → `/app/targeting`, "Turn on the app embed" →
  `/app`), often deep-linked to the right sub-section (`?seg=timing`).
- **§13b — Empty states and locked features point forward too.** An empty report links
  to what will populate it; a banner links to its own resolution. A dead-end is a bug.
- **§13c — Deep-link to the segment, not the page.** When the fix is one control inside
  a tabbed page, link straight to that tab/segment so the merchant lands on it, not on
  a page where they still have to search.

### §14 — Reversible & non-destructive by default
Merchants operate on a **live store** and fear breaking it. Every powerful action must
be reversible and must **say so**, and "turn it off" must never mean "lose the setup".

- **§14a — Off ≠ erased.** Quiet mode mutes every toast without discarding a single
  setting; disabling a feature preserves its configuration for when it's switched back.
- **§14b — A way back is always visible.** "Reset to default design", saved config
  versions with restore (`listConfigVersions` / `restoreConfigVersion`) — the merchant
  can always undo a bad exploration. Depth is safe to explore only because it's safe to
  undo.
- **§14c — Destructive actions announce themselves.** Anything that truly loses data
  says what will be lost before it happens; the default path is the safe one.

### §15 — The empty state teaches, it doesn't apologise
"Honest on empty" (§5) forbids fake data; §15 adds the positive duty: a first-run /
empty surface is **prime onboarding real estate**. Instead of a sad "no data yet", show
what the merchant will see once it fills, and the one step that gets them there.

- **§15a — Show the shape of success.** Explain what the first real order/event will
  populate (a sample-labelled preview, "this is where 'N sold today' will appear"),
  so the value is legible before any data exists.
- **§15b — One clear next step.** An empty state offers exactly one action that starts
  the flow (turn on the embed, place a test order), never a shrug.

### §16 — Plan-gating that sells, not just locks
A2 says never block Free; §16 governs *how the locked thing looks*. A Pro feature a
Free merchant can't use must still be **visible and show its value** — a preview, an
Effect Proof, the real UI behind a soft lock — so the gate is an invitation, not a
grey wall.

- **§16a — Locked ≠ hidden.** Keep the feature on screen with its Pro marker
  (`ProFrame` soft-lock + amber `PlanBadge`), so the merchant sees exactly what they'd
  get. A hidden feature can't be desired.
- **§16b — The amber is the only plan signal.** Plan state rides the one amber code
  (§11a); the lock never borrows the selection blue or status green.
- **§16c — Show, don't just tell, the upside.** Where possible let the preview/proof of
  the locked feature run, so the value is felt, not just described in an upsell string.

---

## Architecture decisions (cross-cutting)

These generalize decisions made while building; apply them to every `won-*` app.

### A1 — One shared render layer; preview == storefront tokens
There is exactly **one** component that renders the app's core visual primitive
(Won Toasts: `WonToastCard`). Every preview surface — static, animated, to-scale
— renders *that* component, reading the **same design tokens** (`--won-*` CSS
variables) the storefront host sets. A visual difference between two previews, or
between preview and storefront, is a bug. Never duplicate the primitive's markup
per surface.

### A2 — Free/Pro layering: never block Free, extend inline
The Free tier must **never read as blocked** — a merchant who feels punished
uninstalls. Pro is an **extension layered inline** below the fully-functional
Free control (one visual card, Free on top, Pro under a divider in a `ProFrame`),
not a separate wall. Advanced/precision capability is Pro; the honest default is
Free. Server-side gating (`gateConfigForPlan`) is **authoritative** — the UI lock
is a courtesy, never the enforcement.

### A3 — Status-first, outcome-grouped IA
A list of features is organised by **what it achieves for the shopper**, not as a
flat enumeration, and it **leads with status** (what's live right now). A picker
should answer "what is running on my store, and what could I turn on next?" — not
just name the features. (Won Toasts: Cart & checkout / Urgency / Social proof /
Your message, each showing on/off + a live count.)

### A4 — Previews render the real context, not a void
A positioned/placement preview shows the **real surrounding context** — the
shop's fixed header, the page chrome — and respects it. Toasts clamp **below the
header** (mirroring the storefront runtime's sticky-header avoidance) in static
**and** animated modes. A preview that shows an impossible state (a toast
covering the header) is lying and must be fixed.

### A5 — Locale-as-data
Copy is **data, not code**. Merchant-editable strings live in config per locale
and round-trip through save/restore; the app never hard-codes shopper-facing
wording that a merchant should own.

### A6 — Simple surface, sophisticated engine
Match the **merchant-facing complexity to the app's actual scope**, never to the
engine's sophistication. The heavy lifting — measurement, experiments, auto-
rollback, sensible defaults, AI — lives in the engine and stays hidden; the
merchant sees **few controls, one-click actions, honest insight cards (not
dashboards), and progressive disclosure**. A single-primitive app (a notification
engine, a stepper) must never feel like a data platform. If a feature adds
cognitive load without clear merchant value, it belongs under "auto" or gone.
Corollary — **every change is safe & reversible**: impactful changes deploy as
measured experiments (auto-promote on win, auto-rollback on loss/guardrail
breach), and a dead-simple visual **rollback timeline** (human-readable diff,
one-click revert, instant preview) means no change can strand the merchant.

---

## Decision log

Newest first. Each entry: what changed, why, and the sections it enacts.

- **2026-08-10 — Added A6 (simple surface, sophisticated engine).** From the MVP13
  planning session: the merchant asked to keep Won Toasts simple ("a notification
  engine shouldn't feel like a data platform") even as the engine gains rich
  analytics, experiments, and AI. Codified as A6 + the "every change is safe &
  reversible" corollary (experiment-gating + one-click rollback timeline). Governs
  all `won-*` apps. MVP13 plan (`won-toasts-mvp-plan.md`) carries it as its binding
  surface-discipline principle.

- **2026-08-09 — Generic theme Wave 3 (PDP).**
  - Shoppable hotspots can take a **separate mobile position** (toggle + mobile
    x/y, applied via a `≤749px` CSS-var override) — red→green spec, smoke 54/0.
  - FAQ layouts (`won-panels`): verified **already complete** (tabs/accordion,
    stacked/split, image left/right via `split_position`) — stale task, no change.
  - Product gallery: investigated; the **native Horizon block is already
    comprehensively configurable** (grid/carousel, columns, thumbnail pos/size,
    aspect/fit, zoom). Documented its full config in `won-design-system.md`
    instead of forking it — rebuilding would lose Horizon upgrade-safety.

- **2026-08-09 — Generic theme Wave 2 (editor clarity).**
  - Every active `won-*` section now leads with a "what is this for" paragraph
    (`t:won.info.*_about`, 19 sections, en+cs) and every section's preset carries
    a `category` so the "Add section" picker groups them (Hero/Content/Products/
    Layout/Apps) — enacts **§7** and the theme design-system's help-on-every-
    section rule.
  - Sticky ATC gained two floating styles (Center pill / Corner card) with
    editor-set corner-radius + bottom-offset — the theme-side of the Wave-0
    "sticky ATC = both surfaces" decision. Shipped with red→green Playwright
    specs (corner geometry, center geometry, style-class wiring); smoke 53/0.
  - Native Horizon sections that duplicate a Won equivalent (hero, carousel,
    marquee, slideshow, media-with-content, collection-list, …) are hidden from
    the "Add section" picker via a centralised compose step that strips their
    presets — merchants pick the Won version, no confusing duplicates. Full
    theme-check (heap-bumped) shows 0 offenses on won-* files.

- **2026-08-09 — Won Toasts Wave 1e (space + copy).**
  - Widened the sticky preview column on Toasts (340→400) and Design (340→420) so
    a full-page app gives the preview real width instead of a thin rail beside an
    over-wide form — enacts **§1**.
  - Added the missing one-line "what it does" intro to the Countdown panel so
    every toast type leads with a plain-language purpose — enacts **§4**.

- **2026-08-09 — Won Toasts Wave 1d (Design clarity).**
  - Custom CSS: fixed a wrong documented hook — the container is
    `[data-won-toasts-region]` (plural), not `[data-won-toast-region]`; the old
    selector matched nothing. Added a no-code-first answer to "make my cart toast
    look different from announcements" (per-type **Look & timing** → then
    `[data-won-type="cart"]`) and made the two CSS axes explicit: `[data-type]` =
    shopper action, `[data-won-type]` = toast type — enacts **§4, §3k**.
  - "Start from a look" presets now render **visual swatch cards** (the preset's
    own bg/accent/radius + palette dots) instead of plain buttons — enacts **§1**.
  - Verified per-type "Look & timing for this toast" is already a visible
    first-class card (not hidden) — the backlog task was stale.

- **2026-08-09 — Won Toasts backlog Wave 1.**
  - Targeting: merged the Free (exclusions) and Pro (positive targeting) sections
    into **one visual card**, Free leading, Pro under a divider — enacts **§7c,
    A2**. Data models stay separate and independently gated.
  - Toasts page: replaced the flat type-chip row with an **outcome-grouped,
    status-first launcher** (`ToastLauncher`) — enacts **§7b, A3**.
  - Previews: extracted the single **`WonToastCard`** layer used by all three
    preview surfaces, added a fixed **shop header + clamp** and an **Animate**
    toggle to the to-scale storefront preview — enacts **§3, §3e, A1, A4**.
