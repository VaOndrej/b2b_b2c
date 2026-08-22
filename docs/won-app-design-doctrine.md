# Won App Doctrine

**The binding invariants and decision principles for every `won-*` Shopify app.**
Hand this document to any engineer, reviewer, or AI coding agent with a new Won
Shopify project and say: *"These are the invariants. Design, implement, and review
the app against them."*

The meta-principle above everything else:

> **Simple for the merchant, sophisticated underneath.**
> We do not design the admin from the database schema. We do not show the merchant
> complexity just because the engine contains it. Prefer **merchant-in over
> engineer-out** at every decision — but never buy UI simplicity with bad
> architecture, technical debt, a security compromise, or by merely *hiding* a
> problem.

This file has two parts:
- **Part I — Product & Admin-UX** (`§1`–`§17`, `A1`–`A7`): how the app looks, reads,
  and feels to a merchant. Mature; the `§` numbers are **stable** because the
  codebase cites them in comments/PRs (`doctrine §7b`) — never renumber them.
- **Part II — Engineering & Platform** (`SEC-`, `WBH-`, `DATA-`, …): how the app
  behaves as software on a live commercial platform — security, data, webhooks,
  billing, reliability, performance, privacy, testing, deploy.

---

## How to read a rule

Every rule carries a **taxonomy tag** so you know how durable it is:

| Tag | Meaning | Treat as |
|---|---|---|
| **[INV]** | **Invariant** — true long-term regardless of platform churn. | Law. |
| **[PLAT]** | **Shopify platform rule** — a current Shopify requirement/behaviour. Dated; may change. | Law today; re-verify at the noted date. |
| **[WON]** | **Won convention** — our portfolio-consistency choice. | Law within Won; not a universal truth. |
| **[APP]** | **App-specific** — a single app's decision. **Must not** be promoted to global. | Example only. |

**Principle vs implementation.** A rule states the *principle*; concrete component
names, hex values, routes, and function names are the *current implementation* and
appear tagged `Example:`. When you clone a new app, you inherit the principles, not
Won Toasts' components.

Platform facts are verified against Shopify Dev docs; see the **Verified platform
facts** appendix (dated) at the end. When a `[PLAT]` rule looks stale, re-verify
there first.

> **How to use.** Cite the rule id (`§7b`, `WBH-2`) in code comments and PRs, exactly
> as Won Toasts does. If a rule proves wrong for an app, change it *here* and note the
> exception — don't fork the doctrine silently.

Related: [product-roadmap.html](product-roadmap.html) (one app = one primitive),
[nova-aplikace.md](nova-aplikace.md) (new-app procedure). The Czech
`apps/_template/docs/ADMIN-UX-PRINCIPLES.md` is a **localized pointer** to this file,
not a second source of truth.

---

# PART I — PRODUCT & ADMIN-UX

## The principles (§1–§17)

### §1 — Preview-first `[INV]`
Every merchant-editable surface shows a **live preview** of the real result, not an
abstract form. If a setting changes what shoppers see, the merchant must see that
change *before* saving. No "save and go look at your store to find out."

### §2 — The preview reflects what they're typing `[PLAT]` (Polaris web components)
The preview binds to **native `input`/`change` events** and re-reads the form on every
keystroke. Polaris `s-*` web components don't fire React `onInput`/`onChange`, so a
React-only binding leaves the preview frozen — always attach a listener to the DOM
form ref and read `new FormData(ref)`. *Platform-dependent: tied to how Polaris custom
elements emit events; re-verify if the component model changes.*

### §3 — One honest scene that exercises every dimension `[INV]`
- One **representative scene**, no scenario switcher, that exercises **every editable
  dimension** so nothing the merchant tunes is invisible.
- **§3c** — *every* storefront-affecting control moves the preview.
- **§3e** — offer an **animated** preview (enter/stay/leave, real timing & stacking),
  not only a static image.
- **§3f** — metrics render as **charts + colour**, never a bare number wall.
- **§3g** — Pro-gated blocks carry a **consistent visual marker** (see §16/§11a).
- **§3i** — a preview must never become an **endless scroll**; cap and clamp it.
- **§3k** — live **custom CSS** is injected into the preview scope so the merchant
  never edits blind. Document stable hooks. *(See SEC-3 — custom CSS must be sanitized/
  scoped; the escape hatch is not a security hole.)*

  *Tension with §9c:* "show every dimension at once" vs "collapse N near-identical
  fields". Resolution: every dimension must be **reachable and preview-linked**, but
  repetitive dimensions may live behind a disclosure that still feeds the preview
  (hidden fields submit). Visible-first ≠ all-visible.

### §4 — Human copy, never raw machine values `[INV]`
- Dynamic values via **clickable token chips** (`{count}`, `{name}`), never hand-typed.
- Time/money entered in **human units** (seconds, currency), converted internally.
- **§4b** — destructive changes recoverable via **version history + one-click rollback**
  (see §14), not a raw-JSON backup.
- **§4c** — **no raw enum key** ever renders in the UI; everything gets a human label.

### §5 — Real data, honest on empty `[INV]`
Won apps show **real data or nothing** — real inventory/orders/counters, never
fabricated proof; on an empty store the app is honest (shows zero / hides the claim).
*↳ This is the shopper-data-authenticity consequence of the parent honesty rule §12.
The positive onboarding side of "empty" is §15.*

### §6 — Visual grouping carries meaning `[INV]`
Spacing and grouping are semantic. A control that belongs to a group sits *in* that
group; nothing floats "glued" to a neighbouring block it doesn't belong to.

### §7 — Shallow, task-based IA `[WON]`
- Collapse settings into a few **task-based destinations**, not a deep tree.
- **§7b** — the **studio shell**: one shared picker + one focused panel at a time + a
  sticky live preview, the same shape on every config page and every app.
- **§7c** — configure a thing **where it lives**: related settings unify on one page.
  **Primary** controls are visible first-class blocks; **rare/advanced** controls stay
  first-class but **collapsed by frequency-of-use** (see §9).
  *Decision rule for "primary vs advanced" (resolves the §7c×§9 tension): rank by
  observed/expected use; if first paint shows more than ~5–7 primary controls without
  scrolling, or a block of ≥4 near-identical fields, it's over-exposed — collapse.*

### §8 — Structure over a wall of fields `[INV]`
No flat wall of inputs. Complex config gets a **purpose-built layout**.
- **§8b** — an N×M relationship (events × languages) renders as a **grid/matrix**, not
  a flat list. Hidden fields still submit; collapsing affects only visibility.

### §9 — Simple surface, deep underneath (progressive disclosure by frequency) `[WON]`
Depth is the moat — but **opt-in, never the default view**. A config screen reads
**short and calm on first paint**; power lives one click away. Tempers §7c: first-class
≠ always-open.
- **§9a — Rank by frequency, not by schema.** Show the ~20% of controls the ~80% touch;
  collapse the rest behind a labelled disclosure. Giving every schema field its own
  always-visible control is the engineer-out failure mode.
- **§9b — Every collapsed block ships a strong default.** The merchant who never opens
  it still gets a good result (see DATA-2 — defaults are part of the data model).
- **§9c — Repetition IS overwhelm.** N near-identical fields read as a wall; collapse or
  **lazy-add** (one row at a time) rather than pre-rendering N empties.
- **§9d — The disclosure summary tells the truth.** A collapsed block states its state
  ("inherits global" / "customised", "1 currency set").
- **§9e — Calm test.** Screenshot the full page on first paint; if it violates the §7c
  decision rule, re-lay it out.

### §10 — Effect Proof (show the mechanism, don't describe it) `[WON]`
Where a setting has a **non-obvious consequence**, glue a tiny inline **Without → With**
illustration to it, drawn from a faithful mock of the same primitive the shopper sees.
§1 applied to a single control, at the point of decision.
- **§10a** — show the mechanism, not a description (`▪▪▪▪ → ▪ +4`).
- **§10b** — the proof MUST be true to the runtime; put the shared arithmetic in the
  engine/core so admin and runtime can't drift *(the general form of this is DATA-4)*.
- **§10c** — reactive where the effect is value-dependent.
- **§10d** — only where the consequence is non-obvious (a proof on a trivial on/off is
  noise and violates §9).
- **§10e** — one shared primitive, not per-setting one-offs.
  *Example:* `EffectProof` + `ProofChip` + `capProof` (Won Toasts).

### §11 — One meaning, one colour (consistent, non-overloaded semantics) `[WON]`
Each visual code carries **exactly one meaning**, the same everywhere.
- **§11a** — the codes are orthogonal and never collide: **blue = selected/active**,
  **amber = Pro/plan** (§16), **green = live/on** (§11d). A fourth meaning means a
  fourth deliberate code.
- **§11b** — one selection affordance, from **one shared source**, never re-typed per
  card (same lesson as §10b / DATA-4). *Example:* `selectionRing()` / `WON_SELECT`.
- **§11c** — same meaning, pattern may differ by control type (a ring vs a raised pill);
  unify the token, not the whole shape.
- **§11d — State is legible at rest.** Selected / on / Pro readable **without
  interacting** — a word, a dot, the ring. *↳ Consolidates the old "is it live?" status
  invariant and A3's "lead with status": the merchant never clicks to discover state.*

### §12 — Honest by construction (never fabricate what looks like proof) `[INV]`
Anything that reads to a shopper as a **fact about the store** — social proof, scarcity,
countdowns, "N bought", "only N left" — must trace to **real store data or not render at
all**. Suite soul + Shopify survival rule: fake urgency is a dark pattern that gets apps
rejected. *This is the parent of §5.*
- **§12a — No data, no component.** A feature with nothing real to show hides itself.
  *Example:* the social-proof feed enables only past a real-order threshold
  (`coldStartReady`). *(NB: real name+city = Level 2 protected customer data → PRIV-1.)*
- **§12b — Every claim is traceable.** If you can't point at the row that makes a claim
  true, it doesn't ship. Auto-promotion of an A/B winner fires only on a measurable win
  (see EXP-1).
- **§12c — The merchant can't turn honesty off.** Copy is editable (§4); the underlying
  fact is not fakeable. Design the data path so a dishonest state is **unrepresentable**
  (the general form is DATA-2).

### §13 — Never dead-end — link to the fix `[WON]`
Any screen that **diagnoses, blocks, or demands an action** carries the merchant to the
**exact control** that resolves it — a deep link, not "go to settings and look".
- **§13a** — diagnosis ships its own fix link (`action: { label, href }`).
- **§13b** — empty states and locked features point forward too. A dead-end is a bug.
- **§13c** — deep-link to the **segment**, not just the page.
  *↳ The homepage search-and-deep-link and §15b's "one next step" are the same rule:
  navigation always terminates at a control, never at a shrug.*

### §14 — Reversible & non-destructive by default `[INV]`
Merchants operate on a **live store**. Every powerful action is reversible and says so;
"turn it off" never means "lose the setup".
- **§14a — Off ≠ erased.** Muting/disabling preserves configuration.
- **§14b — A way back is always visible.** Reset-to-default + saved config versions with
  restore. *(Bounded by PRIV-2 retention — history is not kept forever.)*
- **§14c — Destructive actions announce themselves** before data is lost.
  *↳ Absorbs the former A6 "every change safe & reversible" corollary; A6 now points here.*

### §15 — The empty state teaches, it doesn't apologise `[WON]`
§5 forbids fake data; §15 adds the positive duty: a first-run surface is prime
onboarding real estate.
- **§15a — Show the shape of success** (a sample-labelled preview of what the first real
  event will populate).
- **§15b — One clear next step**, never a shrug (see §13).

### §16 — Plan-gating that sells, not just locks `[WON]`
Governs *how the locked thing looks* (A2 governs *never blocking Free*). A Pro feature a
Free merchant can't use stays **visible and shows its value**.
- **§16a — Locked ≠ hidden.** Keep it on screen with its Pro marker (amber). A hidden
  feature can't be desired.
- **§16b — Amber is the only plan signal** (§11a); the lock never borrows selection blue
  or status green.
- **§16c — Show, don't tell, the upside** — let the preview/proof of the locked feature
  run **in the admin preview only**. *(This is preview, not entitlement: a locked
  feature must never actually emit on the storefront without server entitlement —
  BILL-1.)*
  *↳ §16, A2, and §3g are three faces of one plan-gating system; A2 is the "never block"
  invariant, §16 the visual treatment, BILL-1 the server authority.*

### §17 — A section leads with its state, not its schema `[WON]`
A section header names the *thing*; that is not enough. Every section and every
card carries three slots **before** its body:

1. **Identity** — a glyph + the title.
2. **State at rest** — one line of the **current configuration in human words**
   ("Bottom right · 40 px from the edge · up to 3 at once"), plus its On/Off or
   Pro marker. This is §11d applied one level up: the merchant learns what a
   section is set to without opening it.
3. **Consequence** — optionally, the §10 proof or a mini render of the primitive.

*The failure mode this fixes:* a screen whose headings read `Look`, `Placement`,
`Timing` over identical grey fields describes the **database schema**, not the
merchant's store. It is the "engineer-out" default and it reads as flat and
uninformative no matter how it is styled — the fix is information, not decoration.

- **§17a — The summary comes from a shared formatter, never a hand-built string.**
  `describePlacement(global)` lives in the engine beside the sanitizers. If each
  route composed its own sentence, two screens would eventually describe one
  config differently, and the next app would rewrite all of them. *(Same lesson
  as §10b / §11b / DATA-4.)* Being pure functions, they are unit-tested.
- **§17b — The summary is live.** It reflects what the merchant is typing, on the
  same binding the preview uses (§2) — a stale state line is worse than none.
- **§17c — The summary never claims more than the config guarantees.** With
  auto-dismiss off, "Stays 5 s" is a lie: say "Stays until dismissed". Where a
  Pro setting isn't applied on the merchant's plan, the header states what is
  *actually in force* (§12).
- **§17d — Collapsed still tells the truth.** A collapsed section shows slots 1–3
  and hides only the body — which is what makes §9's progressive disclosure safe.
  Collapsing hides, it **never unmounts**: hidden fields must keep submitting.
- **§17e — Structure, not hue.** Identity glyphs are neutral. Blue is selection,
  amber is Pro, green is live (§11a); a per-section colour would invent a fourth
  meaning and collide with all three.
- **§17f — A second column is opt-in.** A section may put its local consequence
  beside its controls; one with no meaningful local consequence stays single
  column, because a proof on a trivial toggle is noise (§10d).
  *Example:* `WonSection` / `WonBlock` + `describe*()` (Won Toasts).

## Architecture decisions (cross-cutting) `[WON]` unless tagged

### A1 — One shared render layer; preview == storefront tokens `[INV]`
Exactly **one** component renders the app's core visual primitive; every preview surface
renders *that* component from the **same design tokens** the storefront host sets. A
visual difference between two previews, or between preview and storefront, is a bug.
*Example:* `WonToastCard`. *(General form for non-visual logic: DATA-4.)*

### A2 — Free/Pro layering: never block Free, extend inline `[WON]`
Free **never reads as blocked**. Pro is an extension layered inline below the fully
functional Free control, not a separate wall. Server-side gating is authoritative
(BILL-1); the UI lock is a courtesy.

### A3 — Status-first, outcome-grouped IA `[WON]`
Features organised by **what they achieve for the shopper**, leading with **what's live
now** — "what's running, and what could I turn on next?" (see §11d for the legibility.)

### A4 — Previews render the real context, not a void `[INV]`
A placement preview shows the real surrounding context (fixed header, page chrome) and
respects it in static and animated modes. A preview showing an impossible state is lying.

### A5 — Locale-as-data `[INV]`
Merchant-editable shopper-facing copy lives in config **per locale** and round-trips
through save/restore; never hard-code wording a merchant should own. *(See MKT-1 — the
engine is locale/market-agnostic, of which this is the copy half.)*

### A6 — Simple surface, sophisticated engine `[WON]`
Match merchant-facing complexity to the app's **scope**, never to the engine's
sophistication. Heavy lifting (measurement, experiments, AI, defaults) stays hidden; the
merchant sees few controls, one-click actions, honest insight cards, progressive
disclosure. A single-primitive app must never feel like a data platform. *Reversibility
of automated change: see §14 + AI-2.*

### A7 — One section shell per app `[WON]`
Exactly **one** component draws a section, and exactly one draws a block inside it.
Every config surface renders *that* component. A visual difference between two
sections is a **bug**, not a styling choice — the same rule A1 imposes on the
preview, applied to the admin chrome around it.

This is what makes §17 portable: the three slots are enforced by the shell's
props, so a new screen cannot accidentally ship a bare heading, and a new app
inherits the whole pattern by importing one component plus its formatters.
Surface tokens (ink, line, wash, card shadow) live beside it, so restyling the
entire admin is a change to a handful of values, not a sweep through routes.
*Example:* `WonSection` + `WonBlock` + `lib/tokens.ts` (Won Toasts).

---

# PART II — ENGINEERING & PLATFORM

The rules below are what keep a Won app safe, correct, and shippable on a live
commercial platform. Format per rule: **Rule / Why / Required / Forbidden /
Verification** (compressed where a rule is self-evident). Each has a concrete **failure
mode** — if a rule has none, it doesn't belong here.

## Security & trust boundaries

### SEC-1 — The server is the only authority `[INV]`
**Rule:** Security, authorization, validation, integrity, and entitlement are enforced
**server-side**. Client state and UI restrictions are UX, never a trust boundary.
**Why:** A determined client bypasses any front-end check.
**Required:** Every privileged action re-checks authorization and re-validates input on
the server; the server never trusts a value simply because the UI produced it.
**Forbidden:** "The UI hid the button, so we don't need a server check." Deriving
permission/plan/identity from a request-supplied field.
**Verification:** For each mutation, name the server-side check. Try the request with the
UI guard removed — it must still be rejected.
**Failure mode:** Free user hand-crafts a request and uses Pro; attacker mutates data
they shouldn't.

### SEC-2 — Every request is scoped to an authenticated shop `[INV]`
**Rule:** The `shop`/tenant identity comes from the **verified session**, and **every**
read and write is filtered by it.
**Why:** A missing tenant filter is a cross-shop data leak — catastrophic and a Built for
Shopify blocker.
**Required:** All queries include the shop scope; shop is never read from a client-
supplied parameter for authorization.
**Forbidden:** Global queries in request paths; trusting `?shop=` for data access.
**Verification:** Grep data-access paths for the shop filter; a multi-shop test asserts
shop A never sees shop B's rows.
**Failure mode:** Store B's orders/PII surface in Store A.

### SEC-3 — Untrusted until sanitized; dangerous state is unsavable `[INV]`
**Rule:** All merchant/shopper input is untrusted until the server validates and
sanitizes it; input that could break out (custom CSS/HTML, injected markup) is scoped and
neutralised **before** persistence.
**Why:** We deliberately offer escape hatches (custom CSS is a Pro feature, §3k) — an
escape hatch without a safety rule is a weapon (XSS, CSS breakout onto the storefront).
**Required:** Server-side sanitize/scope of all rich input; custom CSS is confined to the
app's scope (e.g. shadow DOM / prefixed selectors); output encoding on every injection
point.
**Forbidden:** Rendering merchant-supplied HTML/CSS unscoped; storing input the sanitizer
rejected.
**Verification:** A test injects `</style><script>` / breakout selectors and asserts they
neither persist nor escape the app scope.
**Failure mode:** Merchant (or a compromised session) injects script that runs on the
storefront for every shopper.

### SEC-4 — Secrets live only server-side `[INV]`
**Rule:** API secrets, tokens, and signing keys never reach the client bundle, the repo,
or logs; they come from the server environment.
**Verification:** Grep the client bundle and repo for secret patterns; CI secret-scan.
**Failure mode:** Leaked token → full-shop compromise.

## Billing & entitlement

### BILL-1 — Entitlement is server-derived from a verified subscription `[INV]` `[PLAT]`
**Rule:** What a merchant is entitled to is computed **server-side** from Shopify's
authoritative billing/subscription state, never from a front-end flag. On any billing
uncertainty (stale/failed/downgraded), **default to Free**.
**Why:** "Frontend says Pro → Pro" is revenue leakage and produces broken states after
downgrade/cancel/trial-end.
**Required:** A single server-side entitlement resolver gates Pro features (the UI lock
mirrors it, §16/A2); downgrade/cancel/trial-expiry paths are handled; Free is the safe
fallback.
**Forbidden:** Emitting a Pro-only storefront effect based on a client claim; caching
entitlement past its validity without reconciliation.
**Verification:** Toggle the subscription server-side and confirm the feature follows;
simulate a billing lookup failure and confirm Free fallback.
**Failure mode:** Cancelled merchant keeps Pro; or a paying merchant loses it on a
transient error.

## Webhooks

### WBH-1 — Verify the webhook, respond fast, process async `[PLAT]` (verified 2026-08)
**Rule:** Every webhook verifies the Shopify **HMAC**; an invalid HMAC returns **401**. A
valid one returns a **2xx quickly** and does heavy work asynchronously.
**Why:** Shopify requires HMAC verification and a prompt 2xx; slow handlers get retried
and eventually the subscription is disabled.
**Required:** HMAC check before processing; ack within the platform timeout; offload work
to a job.
**Forbidden:** Trusting an unverified payload; doing long work inline before the ack.
**Verification:** A bad-HMAC request returns 401; a valid one returns 2xx under the
timeout.
**Failure mode:** Spoofed webhook mutates data; or real webhooks get disabled for slowness.

### WBH-2 — A webhook is an at-least-once, maybe-out-of-order event, not truth `[INV]`
**Rule:** Handlers are **idempotent** and assume duplicate, delayed, and out-of-order
delivery; critical state is **reconciled** against Shopify rather than derived purely from
the event stream.
**Why:** Shopify guarantees neither exactly-once nor ordering.
**Required:** A dedupe/idempotency key per event; effects safe to apply twice; a
reconciliation path for critical counters.
**Forbidden:** "This event arrives exactly once, in order." Incrementing authoritative
state from a raw event with no idempotency.
**Verification:** Deliver the same event twice and reversed; end state is identical and
correct.
**Failure mode:** Duplicate `orders/create` → double-counted or duplicate side effects.

### WBH-3 — Mandatory compliance webhooks are always implemented `[PLAT]` (verified 2026-08)
**Rule:** Every app subscribes to and correctly handles **`customers/data_request`,
`customers/redact`, `shop/redact`** — even if the app stores no personal data.
**Why:** Shopify App Store requires it; missing/incorrect handlers = rejection. Invalid
HMAC on these must return 401. Redaction acted on within 30 days; `shop/redact` fires ~48h
after uninstall.
**Required:** All three subscribed (TOML/Partner Dashboard); redact handlers actually
delete/anonymise the identified data (see PRIV-2); data_request returns the stored data.
**Verification:** `shopify app` webhook triggers; a test asserts redact deletes the rows.
**Failure mode:** App rejected at review; or a legal redaction request is silently ignored.

## Privacy & data lifecycle

### PRIV-1 — Data minimization; protected customer data is gated `[PLAT]` `[INV]` (verified 2026-08)
**Rule:** Store only data with an **active purpose**. Customer data including
**name/address/phone/email is Level 2 protected customer data** — request the minimum in
the Partner Dashboard, use it only for the stated purpose, and **tolerate null/redacted**
values.
**Why:** Shopify's protected-customer-data policy (data minimization + approval) and GDPR/
CPRA. Concretely: any Won feature reading order PII (e.g. a social-proof feed's name+city)
triggers this.
**Required:** Scope request = minimum; a documented purpose per PII field; code paths
handle gated fields being null/redacted without breaking.
**Forbidden:** Requesting PII "in case it's useful"; crashing when a field is redacted.
**Verification:** Enumerate stored PII → each maps to an approved purpose; a null-PII test
passes.
**Failure mode:** Review rejection; or a breach with more PII exposed than needed.

### PRIV-2 — Deletion on command; bounded retention `[PLAT]` `[INV]`
**Rule:** Implement redaction (WBH-3) and **uninstall cleanup**, completed within 30 days,
and give every PII/event/config-history store a **defined retention window**.
**Why:** Legal deletion duty; and it resolves the tension between §14 (keep history to
undo) and minimization (keep little) — bound the history.
**Required:** Redact/uninstall paths delete or anonymise; retention windows are explicit
and enforced (config-version history included).
**Verification:** After redact/uninstall, the data is gone; a retention job prunes past
the window.
**Failure mode:** Unbounded PII accumulation "because it might be useful" (explicitly
forbidden).

### PRIV-3 — No PII or secrets in logs `[INV]`
**Rule:** Logs enable diagnosis **without** carrying PII or secrets.
**Verification:** Log-line review / a redaction filter test on known PII fields.
**Failure mode:** PII leak via log aggregation; compliance incident.

## Data architecture

### DATA-1 — The source-of-truth split is a deliberate decision `[INV]`
**Rule:** For each data field, consciously decide **Shopify (metafield/metaobject) vs app
DB vs computed-at-runtime**, and don't duplicate what Shopify owns.
**Why:** Silent copies of Shopify-owned truth drift and force fragile sync.
**Required:** Each stored field has a one-line "why here"; Shopify-owned data is read, not
mirrored, unless there's a stated caching reason (with invalidation).
**Forbidden:** Copying product/inventory/customer state into the app DB as the primary
truth without a reason.
**Verification:** Schema review names the source of truth per field.
**Failure mode:** App shows stale product data that contradicts the admin.

### DATA-2 — Invalid state is unrepresentable `[INV]`
**Rule:** Merchant/shopper config cannot be persisted in an invalid, partial, or
dishonest shape: **server-side sanitize + schema validation + defaults** fill gaps.
**Why:** The general form of §12c and §9b — a bad state that can't exist can't crash the
render or lie.
**Required:** One server-side sanitizer per config type; partial/nullable inputs get safe
defaults; the render never assumes fields the model doesn't guarantee.
**Forbidden:** Trusting client-shaped config on save; rendering from unsanitized input.
**Verification:** Fuzz/partial-payload tests produce a valid, renderable config or a clean
rejection — never a crash.
**Failure mode:** A malformed/legacy config white-screens the admin or storefront (a real
past incident).

### DATA-3 — Config schema is versioned and backwards-compatible `[INV]`
**Rule:** The runtime reads **older config shapes** (default-filling missing fields);
schema changes are additive/migrated, never a silent break.
**Why:** Deploys aren't atomic; old rows and old clients coexist (DEPLOY-1).
**Required:** A version/shape marker or tolerant reader; migrations backfill; removing a
field is a deliberate, migrated step.
**Verification:** A test loads a prior-version config fixture and renders it.
**Failure mode:** A deploy changes the config shape and the previous saved config stops
rendering.

### DATA-4 — Shared logic lives in the engine, so surfaces can't drift `[INV]`
**Rule:** Any computation that must agree across admin, preview, and storefront lives
**once** in the framework-free engine/core; surfaces call it, never re-implement it.
**Why:** The general form of §10b, §11b, and A1: duplicated logic is duplicated truth that
drifts.
**Required:** Cross-surface arithmetic/state (gating, grouping, formatting, proofs) is a
pure core function with tests; admin/storefront import it.
**Forbidden:** Re-typing the same rule in the client and the storefront bundle.
**Verification:** The shared function has unit tests; grep shows no parallel copy.
**Failure mode:** Preview says one thing, storefront does another (the exact drift A1
forbids).

## Shopify API usage

### API-1 — GraphQL-first, minimum scopes `[PLAT]` (verified 2026-08)
**Rule:** New Admin integrations use the **GraphQL Admin API**; request only the
**minimum scopes** the app actually uses.
**Why:** REST Admin API is **legacy since 2024-10-01**; **new public apps (submitted after
2025-04-01) must use GraphQL exclusively**. Over-scoping causes install friction and
review flags; Shopify restricts scopes not legitimately needed.
**Required:** GraphQL for Admin reads/writes; a justified scope list; REST only where no
GraphQL equivalent exists (documented).
**Forbidden:** New REST Admin calls in a new app; requesting scopes "for later".
**Verification:** No REST Admin usage without a documented gap; scope list maps each entry
to a feature.
**Failure mode:** App can't be submitted / gets flagged; merchants balk at broad scopes.

### API-2 — Batch, paginate, and tolerate partial results `[INV]`
**Rule:** Bulk reads paginate; related data is fetched together (no N+1); GraphQL
responses are checked for **partial errors** and handled per-item.
**Why:** A single unhandled partial error can abort a whole scan.
**Required:** Cursor pagination; per-item error tolerance; rate-limit-aware backoff
(API-3).
**Verification:** A response with one bad item still yields the good ones.
**Failure mode:** One locked/unreadable resource (e.g. a protected theme) throws and kills
the entire query — a real Won Toasts embed-scan bug.

### API-3 — Respect rate limits with backoff `[PLAT]` `[INV]`
**Rule:** Requests respect Shopify's cost-based rate limits; retries use exponential
backoff; heavy work is throttled/queued.
**Verification:** A forced 429/throttle path retries and succeeds without a tight loop.
**Failure mode:** Rate-limit ban; cascading failures under load.

## Reliability

### REL-1 — No infinite loading; every external call has three outcomes `[INV]`
**Rule:** An external (Shopify/DB/3rd-party) request never ends in an indefinite loading
state. Every call resolves to **success / retryable failure / terminal failure**, and on
an actionable error the merchant gets a **concrete next step**.
**Why:** A stuck spinner reads as "the app is broken".
**Required:** Explicit states + timeouts on every external call; actionable error copy
(see §13) with a next step; retryable vs terminal distinguished.
**Forbidden:** `await` with no timeout/catch feeding a spinner; a dead-end error with no
recovery.
**Verification:** Force each dependency to fail/hang; the UI shows a bounded, actionable
state.
**Failure mode:** Merchant stares at a spinner and uninstalls.

### REL-2 — Idempotent mutations, bounded retries, defined degraded mode `[INV]`
**Rule:** Write operations are idempotent; retries use backoff; timeouts are bounded; each
critical path defines its **degraded mode** when a dependency is down.
**Why:** Transient failures and concurrency are normal at scale.
**Required:** Idempotency keys on mutations; a stated behaviour for "Shopify/DB/3rd-party
is down".
**Verification:** Kill a dependency mid-flow; state is consistent and recovers.
**Failure mode:** Half-committed state, double writes, or a total outage from one
dependency blip.

### REL-3 — Answer "what if this exact request dies mid-way?" `[INV]`
**Rule:** Every non-trivial operation's design states what happens on mid-flight failure,
concurrent execution, and a poison job.
**Verification:** Design/PR notes the failure behaviour; a concurrency test where relevant.
**Failure mode:** Race conditions and partial writes that only appear under scale.

## Storefront runtime & performance

### SF-1 — App failure must not damage the storefront `[INV]`
**Rule:** The storefront surface is **isolated and defensive**: DOM/CSS isolation (shadow/
scoped), **no layout shift**, graceful degradation when JS is disabled/delayed, no
duplicate initialization, and correct behaviour inside the Theme Editor.
**Why:** The merchant's store is a live revenue system; our bug there is their lost sale
and a 1-star review.
**Required:** Scoped styles; reserved space (no CLS); idempotent init guard; a no-JS/late-
JS fallback that doesn't break layout; Theme-Editor-aware mount.
**Forbidden:** Global CSS bleed; z-index wars with the theme; injecting after paint in a
way that shifts content; double-mounting on re-navigation.
**Verification:** Theme-compat E2E (TEST-3) asserts no overflow/shift/stacking break on
Dawn+Horizon; a JS-disabled load doesn't break the page.
**Failure mode:** App shifts the PDP, fights the theme header, or breaks a custom theme.

### SF-2 — Every storefront feature explains and budgets its cost `[WON]` `[PLAT]` (verified 2026-08)
**Rule:** Each storefront feature has a **measured JS/CSS budget enforced in CI**, and the
app must **not reduce the storefront Lighthouse score by more than 10 points** (Shopify's
publish bar; weighted Home 17% / Product 40% / Collection 43%).
**Why:** An app that slows a merchant's store loses them conversions and fails Built for
Shopify.
**Required:** A bundle-size/perf gate (e.g. gz budget test); a one-line cost justification
for each new storefront feature; lazy-load non-critical work.
**Forbidden:** Shipping storefront JS with no budget; blocking the main thread for
non-essential work.
**Verification:** CI perf-budget gate; periodic Lighthouse before/after install.
**Failure mode:** Cumulative bloat quietly drags the store below the App Store perf bar.

### PERF-1 — Admin app meets Web Vitals targets `[PLAT]` (verified 2026-08)
**Rule:** The embedded admin meets Built-for-Shopify Web Vitals at the 75th percentile:
**LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms**, with the **App Bridge script in `<head>`** so
Shopify can measure them.
**Why:** These are hard Built for Shopify criteria.
**Verification:** App Bridge script present; Web Vitals dashboard within targets.
**Failure mode:** App can't reach Built for Shopify status.

## Testing

### TEST-1 — Layered tests, each at the right level `[WON]`
**Rule:** Tests are layered: **pure/unit** (engine logic) → **contract** (Shopify API
boundaries + shared core used by multiple surfaces) → **integration** → **E2E storefront**
(Dawn+Horizon) → **theme-compat**. Put each check at the lowest level that can catch its
failure.
**Why:** Shared logic (DATA-4) and API boundaries are where drift and breakage hide.
**Verification:** New engine logic has unit tests; API adapters have contract tests; the
gate maps to the workspace touched.
**Failure mode:** A change passes typecheck but breaks a surface no test covers.

### TEST-2 — A storefront-verifiable change ships with a test; regressions get a red→green `[INV]`
**Rule:** If a merchant would otherwise have to manually check something on the storefront,
an automated test checks it instead. A regression bug is fixed **red → fix → green**, and
the test is committed with the fix.
**Why:** Manual verification doesn't survive the next change; a regression without a
regression test isn't fully fixed.
**Required:** Behaviour/geometry/timing changes ship with a committed spec; the test is
written first and shown to fail on the unfixed state.
**Verification:** The commit contains both the fix and a test that fails without it.
**Failure mode:** A fixed storefront bug silently returns.

### TEST-3 — Theme-compat tests assert the visible result, not the DOM `[WON]`
**Rule:** Compatibility tests against Dawn + Horizon assert the **result a shopper sees** —
geometry, overflow, alignment, stacking, timing, visibility — not merely that a DOM node
exists.
**Why:** "The element is present" passes while the shopper sees it broken.
**Verification:** Responsive-invariant assertions (no overflow, tap targets, stacking) on
real viewports.
**Failure mode:** A node-presence test is green while the toast covers the header on mobile.

## Deploy, dependencies, observability, platform

### DEPLOY-1 — Backwards-compatible deploy; nothing assumes atomicity `[INV]`
**Rule:** Old backend ↔ new frontend and new backend ↔ old frontend must both tolerate
each other during a rollout; DB/config migrations are additive with a rollback path.
**Why:** There is a window where versions coexist; assuming an atomic world breaks it.
**Verification:** A migration is reversible/forward-safe; a mixed-version smoke passes.
**Failure mode:** A deploy briefly serves a broken combination to live merchants.

### OBS-1 — Diagnosable without PII `[INV]`
**Rule:** Structured logs/metrics cover **webhook, billing, install/OAuth, and background-
job failures**, enough to diagnose an incident, and never contain PII/secrets (PRIV-3).
**Verification:** Each failure class emits a structured, PII-free event.
**Failure mode:** A production incident (failed billing, dropped webhook) is invisible and
undiagnosable.

### DEP-1 — Every dependency is a long-term liability `[WON]`
**Rule:** Prefer Shopify-native and platform primitives; a new dependency must justify its
**bundle, maintenance, and security** cost; avoid duplicate/abandoned libraries.
**Verification:** A new dep in review names what it replaces and its cost.
**Failure mode:** Bundle bloat (→ SF-2), supply-chain risk, unmaintained code.

### MKT-1 — Market/currency/locale-agnostic from day one `[INV]`
**Rule:** The engine **never assumes one currency, locale, market, or storefront context**;
presentment currency, multiple locales, and market-specific config are first-class from the
start (copy is data, A5).
**Why:** Retrofitting multi-market into an engine that baked in one is a rewrite.
**Required:** Money/locale flow through as parameters, not constants; per-market/locale
config is representable even if the UI exposes it later.
**Forbidden:** A hard-coded currency symbol, a single-locale string table in the engine, a
"the shop's currency" singleton.
**Verification:** A two-market/two-currency fixture produces correct output.
**Failure mode:** The app is wrong or blank for any merchant using Shopify Markets.

### SHARE-1 — Share stable invariants, not incidental similarity `[WON]`
**Rule:** `@won/app-kit` (auth, billing, nav, tokens, preview primitives, logging, API
wrappers, test helpers) holds only **stable contracts**; a shared change is versioned and
tested so it **cannot silently break** other apps.
**Why:** A "god framework" where one app's change breaks the other nine is worse than
duplication.
**Required:** Shared modules have their own tests and a stable interface; app-specific
divergence stays in the app.
**Forbidden:** Hoisting two apps' accidental resemblance into a shared abstraction.
**Verification:** Changing a shared module runs its contract tests; consumers are checked.
**Failure mode:** A tweak for app A breaks apps B–J.

### AI-1 — AI output is a proposal, never truth `[INV]`
**Rule:** AI output is **previewable and reversible**, never auto-published to the
storefront without a **deterministic guardrail outside the model**; any AI input drawn from
merchant/shopper data is treated as **prompt-injection-hostile**.
**Why:** Hallucinations and injection reaching a live store are direct merchant harm.
**Required:** A human-visible preview + rollback for impactful AI changes; deterministic
validation of AI output before it acts; injection defenses on data-derived prompts.
**Forbidden:** Auto-applying unverified AI changes to the storefront; trusting model output
as fact (see §12/EXP-1).
**Verification:** An AI change is previewable and reversible; a malicious-data prompt can't
drive an action.
**Failure mode:** The model publishes a wrong/injected claim to a live storefront.

### AI-2 — Automation may hide the mechanism, never the consequence `[WON]`
**Rule:** Automated actions (auto-promote, auto-rollback, auto-tune) may hide **how** they
decided, but always keep visible **what happened, why, with what result**, plus an audit
trail and rollback.
**Why:** Resolves the A6 (hide sophistication) × explainability tension: black-box changes
to a live store are unacceptable even when the mechanism is complex.
**Verification:** Every automated change appears in a human-readable history with a revert.
**Failure mode:** The engine silently changes the store and the merchant can't tell what or
undo it.

### EXP-1 — Experiments and insights are genuine and explainable `[INV]`
**Rule:** Analytics events are genuine; conversion is explicitly defined; experiments guard
against contamination, respect sample size, and **auto-rollback on a guardrail breach**;
every merchant-facing "insight" is explainable from its source data.
**Why:** A fabricated or unexplained insight is §12 dishonesty turned on the merchant.
**Required:** Event integrity, a stated conversion metric, guardrail + sample-size checks,
traceable insight provenance.
**Forbidden:** Showing an "AI insight" you can't derive from data; promoting a variant
without a measurable win.
**Verification:** Each insight card links to the data that produced it; experiment logic has
tests.
**Failure mode:** Merchant acts on a made-up number.

### A11Y-1 — Accessibility is definition-of-done `[INV]` `[PLAT]`
**Rule:** Keyboard operability, focus management, semantic labels/aria, reduced-motion,
contrast, and touch targets (≥44px) are part of "done", not a later polish pass.
**Why:** It's a Built for Shopify expectation and excludes real users when skipped.
**Verification:** Keyboard-only pass; automated a11y checks; reduced-motion honoured.
**Failure mode:** Merchant/shopper on keyboard or screen reader can't use the feature.

### STORE-1 — Review-readiness is a property of the system `[PLAT]` `[WON]` (verified 2026-08)
**Rule:** The invariants above map to current **App Store / Built for Shopify**
requirements, so a Won app is **review-ready by construction**, not by a pre-submission
cleanup.
**Why:** Requirements found late (mandatory webhooks, perf, GraphQL, protected data) mean
rework at the worst time.
**Required:** A new app satisfies WBH-3, PRIV-1/2, API-1, SF-2, PERF-1, A11Y-1, and §12
from its first milestone; a release gate checks them.
**Verification:** The release checklist maps each App Store / BFS requirement to a rule
here.
**Failure mode:** App bounces at review for something that should have been structural.

---

## Verified platform facts (dated)

These back the `[PLAT]` rules. Re-verify against Shopify Dev docs when stale.

- **REST Admin API is legacy as of 2024-10-01; new public apps submitted after
  2025-04-01 must use the GraphQL Admin API exclusively.** REST is maintenance-mode.
  (Verified 2026-08 — shopify.dev changelog + REST/GraphQL migration guide.) → API-1.
- **Mandatory compliance webhooks:** `customers/data_request`, `customers/redact`,
  `shop/redact` — required for every App Store app even if it stores no PII; invalid HMAC
  → **401**; act within **30 days**; `shop/redact` ~48h after uninstall; `customers/redact`
  may be delayed. (Verified 2026-08 — Privacy law compliance.) → WBH-1, WBH-3, PRIV-2.
- **Protected customer data:** Level 1 (customer data excl. name/address/phone/email) and
  Level 2 (incl. them) require Partner Dashboard access + data-minimization; apps must
  handle **null/redacted** gated fields (change effective 2025-12-10). (Verified 2026-08.)
  → PRIV-1.
- **Storefront performance:** an app must **not reduce storefront Lighthouse by > 10
  points** (weighted Home 17% / Product 40% / Collection 43%) to publish. (Verified
  2026-08.) → SF-2.
- **Built for Shopify admin Web Vitals @ p75:** LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms; App
  Bridge script in `<head>` required to measure. Checkout (if applicable) p95 ≤ 500ms,
  0.1% failure. (Verified 2026-08 — BFS requirements.) → PERF-1.
- **Access scopes:** request only the minimum necessary; Shopify restricts scopes not
  legitimately required. (Verified 2026-08.) → API-1/API-2.

---

## Decision log `[APP]` — non-portable

Won-Toasts/theme project history; **a new app clones the doctrine, not this log** (start
it empty). Newest first.

- **2026-08-21 — §17 (a section leads with its state) + A7 (one section shell per app).**
  Five separate merchant complaints — "the sections aren't sexy", "this list says
  nothing", "Look & timing is hidden", "Custom CSS is badly explained", "unify
  targeting" — turned out to share one cause: sections described their schema
  instead of their state or their consequence. Added the three-slot section
  (identity / state at rest / consequence), the `describe*()` formatters in
  `@won/core` behind §17a, and `WonSection`/`WonBlock` as the single shell.
  Also recorded two preview lies found while doing it: `NotificationPreview`
  hand-drew its own card (A1) and rendered banner/inline shapes the storefront
  runtime never produces (A4), and the close-up previews had no shop context.
- **2026-08-12 — Restructured into the two-part Won App Doctrine.** Consolidated the
  design doctrine (§1–§16, A1–A6) and added Part II (Engineering & Platform: SEC/WBH/DATA/
  BILL/API/REL/SF/PERF/PRIV/TEST/DEPLOY/OBS/MKT/DEP/SHARE/AI/EXP/A11Y/STORE), added the
  taxonomy tags, and verified all `[PLAT]` rules against Shopify Dev docs. The CZ
  `ADMIN-UX-PRINCIPLES.md` became a localized pointer.
- **2026-08-12 — §10 Effect Proof, §11 one-meaning-one-colour, §12–§16** (honesty /
  deep-link / reversible / empty-teaches / plan-gate-sells) added from merchant review.
- **2026-08-10 — Added A6 (simple surface, sophisticated engine)** + the reversible-change
  corollary (now folded into §14).
- **2026-08-09 — Generic theme Waves + Won Toasts Wave 1** (studio shell, `WonToastCard`
  render layer, outcome-grouped launcher, visual preset cards). See git history for detail.
