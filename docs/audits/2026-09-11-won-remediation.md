# Won remediation + completion — 2026-09-11

Authoritative baseline: [visual audit](2026-09-10-won-visual-audit.md) and [matrix](2026-09-10-won-visual-matrix.md). This is an implementation record, not a new inventory. **Release gate: NOT GREEN.**

Verified target: `b2b-b2c-store-development.myshopify.com`, development theme **161957216497**, local preview `http://127.0.0.1:9292`. No live theme publication or commit. Pre-existing edits preserved against `/private/tmp/won-pre-remediation-20260911`.

## Fixed findings and causes

| Finding | Root cause | Source correction |
|---|---|---|
| qa019 mosaic | Span was on inner tile, not Shopify grid item; circular height dependency | Span actual `.shopify-block`; intrinsic media aspect ratio; cap spans/counts to available columns |
| qa120 bottom badge | Independently positioned badge/title competed for same bottom edge | Shared natural-flow overlay zone; long multiline QA title |
| qa135 corner sticky | Floating shell inherited full container sizing and insets | Content-sized floating shell, wrapping CTA, no overflow clipping workaround |
| Picker tap areas | Quantity button was smaller than Won's 44px contract; hidden inputs confused measurement | Actual controls use `--won-tap`; evaluate separate visible input/label hitboxes, never union empty space |
| qa161 chevrons | Section foreground override resolved white against independent white button | Foreground/background resolve together from the button's own scheme |
| qa102 circle | Negative-z pseudo-element painted behind card without local stacking context | Isolated heading paint context; in-flow padding reserves annotation room |
| qa156 table label | Only aria-expanded changed | Show/Hide translated visible and accessible label tracks expansion, including keyboard |
| qa157 minimal child | Independent foreground with transparent background exposed parent dark surface | Independently configured minimal child owns its scheme surface, without elevation; qa176 control retained |
| Tablet presets | Viewport-only split decisions and percentage heading measures ignored narrow nested parents | Named container queries for slide splits; local heading sizing/measure floor; readable minimum group columns; tablet grid count capped by desktop/actual items; intrinsic marquee items retain normal containment |

## Reusable capabilities / compatibility

- `won-group.column_ratio`: `1:1` (default), `2:3`, `3:2`; two columns when the group has room; mobile stacks in DOM order. Existing child blocks and dynamic sources remain unchanged. Narrow nested groups may stack earlier deliberately.
- `won-product-card.layout`: `card` (default) / `row`. Row uses the same shared price/badges/availability and captured purchase control. No fork of quick-add/cart runtime. Existing default card layout remains intact.
- `won-video.fit`: `cover` (default) / `contain`, for hosted video. Added `aspect_ratio=9/16|adaptive`; native hosted media dimensions for adaptive, external fallback16:9. Existing16:9/4:3/1:1 and YouTube/Vimeo paths retained. External players determine their own image fit; merchant help states this and fit is hidden for external mode.
- New labels use EN/CS/SK translations and explicit English values for other existing locale files. Only new keys added there; old translation debt was not expanded or cleaned up.

## Exact source files

All production changes are under `themes/won-base`:

- `assets/won-tokens.css`
- `blocks/won-group.liquid`, `won-product-card.liquid`, `won-slide.liquid`, `won-tile.liquid`, `won-video.liquid`
- `sections/won-band.liquid`, `won-carousel.liquid`, `won-grid.liquid`, `won-sticky-atc.liquid`, `won-variant-picker.liquid`
- `snippets/won-product-card.liquid`
- `locales/{en.default,cs}{,.schema}.json` and47 additive `locales/existing/*.json` fragments:51 Horizon locale names; only8 new schema keys and1 runtime label per relevant locale. EN/CS preserve existing content; other source overlays contain only the new keys. Compose applies these additions only to languages already present in the selected base, preventing47 incomplete locale packs from being introduced into Skeleton.
- `examples/product.editorial.json`, `examples/qa/generate.mjs`, `examples/qa/manifest.json`

Build infrastructure: `themes/build/compose.mjs` adds the existing-language-only fragment merge described above. Horizon output remains byte-identical after this routing adjustment; Skeleton retains its four original locale files.

The complete individual path list and a diff against the pre-remediation backup are saved in `tmp/theme-audit-runs/2026-09-11-remediation/changed-files.json` and `implementation.patch` (pre-existing edits are outside that patch).

Test changes: `tests/support/cart-state.ts`, `responsive-invariants.ts`; `tests/smoke/won-feedback-8.spec.ts`, `won-toast.spec.ts`, `won-qa-catalog.spec.ts`, `won-remediation-layout.spec.ts`, `won-remediation-editorial.spec.ts`, `won-remediation-capabilities.spec.ts`, `responsive-targets.spec.ts`, `won-block-wrapper-selectors.spec.ts`, `won-editorial.spec.ts`, `won-qa-fixes.spec.ts`. The last two accept opt-in view/output paths so the existing editorial tests exercise the current QA composition and preserve original audit screenshots. The wrapper guard now recognizes `:has(> block)` on the real `.shopify-block` parent; synthetic checks retain rejection of direct section-to-block selectors, including mixed selector lists.

Generated demo templates and Horizon/Skeleton outputs were refreshed by the source generator/compose tooling. Upstream and generated generic theme files were never patched manually.

## QA and visual evidence

Existing IDs retained. qa120 uses a long title. qa160 recommendations use row layout. qa162 benefits/expert uses3:2. qa177–179 cover all column ratios; qa180–182 row single-variant/multivariant/unavailable products; qa183–185 portrait contain/cover external and adaptive external. Catalogue now185cases/31templates.

Evidence root: `tmp/theme-audit-runs/2026-09-11-remediation/`.

- `catalog/`:81 initially affected catalogue captures,27cases ×390/768/1440, all actually inspected in contact sheets.30collector tests passed. Later targeted evidence supersedes initial circle/picker images, andqa008 was additionally captured/reviewed after its intrinsic-width regression was found and fixed. Editorialqa159–167 at all three widths included.
- Tablet: no observed mid-word heading fragmentation; narrow nested composition stacks; review controls remain legible; recommendations compact; two-column FAQ readable without viewport overflow.
- Mobile: DOM-order column collapse, stacked reviews, readable rows and full-size controls.
- Desktop: intended split layouts/ratios and default cards retained. Final annotation captures in `annotation-final/` were separately inspected after padding adjustment; underline remains intact.
- `layout-visual-review.json`:twelve reviewed layout captures and geometric regression results, including marquee controlqa008 at all widths. Its content-sized items retain original intrinsic sizing; page-wide mobile hit-target invariant passes.
- `tmp/theme-remediation/2026-09-11/`:product/video capability captures and tests.

## Cart gate mechanism

The old decrement test read `/cart.js` after the optimistic DOM hid the quantity control. Shopify's update was still pending. Desktop read1 before committed0; mobile could read0 prematurely before an outstanding intermediate update2, so the previous wait could falsely pass as well as fail. Diagnostic timestamps and requests are in `cart-findings.md` and cart diagnostic JSON.

New shared test helper waits for `cart:refresh` with the committed cart, then independently checks real `/cart.js` item_count and empty items. The final ordinary decrement first requires a genuinely committed item_count1; the held-request scenario additionally requires HTTPsuccess and item_count1 from that exact first response. This prevents a rejected add followed by rollback-to-empty from falsely passing. Toast setup verifies the real initial cart first. It clears/reloads only a non-empty cart and always requires the runtime to render quantity0. Toast burst/cap tests wait on committed counts. A new test holds the first real update request behind a barrier, executes +,+,-,-, then releases the actual request, verifies that it successfully persisted one item, and requires the subsequent committed empty cart. No mocked success response, sleeps, retries, skips, or weaker decrement assertion. Production `won-cart.js` did not require modification.

## Verification results

- Horizon + Skeleton compose:passed.
- Targeted layout:9/9; final corner capture3/3; marquee regression3/3. Synthetic hit targets:8/8; final picker state/label hit areas3/3.
- Editorial semantics/ratios:9/9 before final annotation spacing; final run also9/9, including chevron contrast>=3:1.
- Final strict cart repeat: **0 passed /12 failed /0 skipped**, desktop/mobile × two decrement scenarios × three repetitions, no retries. Five failures have direct `/cart/update.js` HTTP429 evidence; five received storefront JSON `unauthorized` without recorded HTTP status; one page explicitly reported render502; one generic error page had no recorded HTTP status. See `cart-strict-failures.md` / `.json`. Earlier synchronization-only passes (including59/60) are superseded and do not establish a green gate.
- Three held-request failures already received429 response headers, then timed out reading the response body inside the assertion message. The final diagnostic-only edit removes that body read and reports HTTP status immediately; success and positive-persistence assertions remain intact. This last diagnostic edit was diff-checked but was not rerun against the throttled storefront.
- Full smoke:472 executions,408passed /25failed /39conditionally skipped,17.9minutes,0retries. Gate is NOT green. Detailed failure classification is in `full-smoke-failures.json` / `.md`:15 proven POST cart429,3 proven GET cart503,1 breadcrumb connection challenge,1 toast error page without HTTP status,4 uninstrumented cart failures, and1 selector-guard false positive. One recorded failure was the wrapper-selector guard false positive, subsequently corrected and verified4/4. The full run preceded the final positive-persistence strengthening of decrement tests; the separate strict12-run result above is authoritative for those tests.
- Existing editorial/QA opt-ins, enabled separately against `won-qa-editorial`: **8 passed /2 failed**. Both native variant tests reached the cart assertion after variant/price checks. Desktop expected selected-variant quantity1 but remained0; mobile `/cart.js` returned HTML instead of JSON. Their HTTP status was not captured, so these two are not classified as proven429. Evidence: `editorial-existing.json`; final full-page desktop/mobile screenshots were also inspected.
- Full-smoke39 skips were existing conditions:18 viewport,11 settings/content,6 editorial opt-in disabled,4 QA opt-in disabled. The latter10 were subsequently exercised in the8/2 run above; no tests were newly skipped to obtain green.
- Theme Check Horizon:baseline16,189 (16,163 MatchingTranslations +26other), final16,189; semantic delta0new/0removed. Skeleton:baseline97, final97; semantic delta0new/0removed. No touched production file introduces any new relevant offense. Intermediate locale-pack expansion was corrected in compose before the final result.
- `git diff --check`:source/tests clean after source whitespace normalization. Global diff check reports1,193 trailing-whitespace findings, all in existing tracked `tmp/theme-dev.log`; retained rather than rewriting unrelated historical log.

## Limits

Initial full-page mobile target signals exposed narrow marquee CTA and standalone button labels; both were fixed and verified with the unchanged44px threshold.

Hosted playback remains unverified because no valid Shopify-hosted fixture is available. External iframe layout/provider loading is verified; providers retain their own letterboxing/network behavior. Existing sample/reviewer copy is explicitly demonstration content, not product claims. Shopify preview intermittently returned connection-verification documents during parallel browser runs; these are not treated as component passes. Native preview CORS/Shop Pay frame restrictions are recorded in evidence; no new Won asset failures or Liquid errors observed in targeted captures.

The remediation run itself did not verify the real row-card purchase scenario under the observed429
responses (capability suite7/8). The forensic follow-up below supersedes that narrow limitation with a
green desktop/mobile row-card lifecycle sample; the complete full-smoke gate remains blocked by the
later preview outage.

## Release gate forensic follow-up

This follow-up preserves the remediation product source unchanged. It classifies the accepted
`408 passed / 25 failed / 39 skipped` run, stabilizes the test boundary, and records fresh evidence
under `tmp/theme-audit-runs/2026-09-11-release-gate/`. It does not retroactively turn an environment
failure into a product pass.

### Classification of the accepted 25 failures

| Classification | Count | Evidence |
|---|---:|---|
| A — confirmed product/runtime regression | 0 | No Won defect reproduced on a normal storefront. |
| B — confirmed test-harness/isolation defect | 1 | The wrapper selector guard rejected valid `.shopify-block:has(> …)` relationships. The corrected guard is green. |
| C — confirmed Shopify/environment/rate-limit/auth failure | 20 | 15 `/cart/update.js` POST 429 responses, 3 `/cart.js` GET 503 responses, 1 Shopify connection challenge, and 1 Shopify error document. |
| D — dependency/content fixture limitation | 0 | None of the 25 baseline failures was caused by a missing content fixture. |
| E — unresolved, insufficient evidence | 4 | Desktop/mobile card parity and sheen tests failed downstream of cart writes without recording those exact HTTP responses. They now pass with instrumentation, but their historical cause cannot honestly be upgraded from E. |

Counts sum to 25. The per-execution machine-readable inventory is
`tmp/theme-audit-runs/2026-09-11-release-gate/failure-classification.json`; the original full stacks,
screenshots, decoded attachments, and page contexts remain in
`tmp/theme-audit-runs/2026-09-11-remediation/full-smoke-failures.json`.

### Root causes and rate-limit evidence

- The failing cart endpoint was primarily `POST /cart/update.js`; initial/independent reads also
  failed at `GET /cart.js` with HTTP 503. A separate diagnostic request received HTTP 429 from
  `POST /cart/clear.js` with `too_many_requests`, “Too many attempts”, and “Please try again in a
  few minutes”.
- The full-run burst test recorded four rejected `/cart/update.js` writes spaced only 759–815 ms
  apart. Tests already ran with one worker and separate Playwright contexts, so no concurrent workers
  shared a cart. The pressure came from repeated remote navigations/mutations in a long-lived shared
  development environment, not cross-worker cart races.
- Historical 429 evidence did not include a `Retry-After` header. The new diagnostics record it when
  present. No generic retry, arbitrary sleep, or rate-limit evasion was added.
- Historical authorization/error pages were exact Shopify responses: JSON `{"error":"unauthorized"}`,
  “Your connection needs to be verified before you can proceed”, an explicit render502 page, and
  “There was a problem loading this website”. No credentials were embedded in tests.
- The final release-configured run later caused Shopify CLI to log “Failed to render section on Hot
  Reload with status 429 (Bad Gateway)” and the local preview process exited. Playwright then received
  `net::ERR_EMPTY_RESPONSE`. The run stopped on the first failure rather than continuing to request the
  store.

### Test-harness changes

- `tests/support/storefront-environment.ts` is the shared environment guard. It distinguishes a normal
  expected storefront from HTTP429, auth, challenge, Shopify error, unexpected store/theme, missing Won
  markers, and navigation failure. Evidence includes final URL, response status/content type,
  `Retry-After`, redirect chain, page title/text excerpt, expected shop/theme markers, and cookie metadata
  without cookie values.
- `tests/support/cart-state.ts` records request method/status/content type/`Retry-After`, console errors,
  page errors, and request failures. Cart reads/writes parse the response once and reject 429, auth,
  5xx, HTML, or invalid JSON as an explicit environment failure. Shopify's normal JSON-compatible
  `text/javascript` response type is accepted.
- The two formerly uninstrumented specs now establish an empty cart through the shared helper, wait for
  the committed `cart:refresh`, and independently read `/cart.js`. The editorial native form requires
  an empty cart but correctly does not require a Won card stepper; it validates the actual cart mutation
  response and then independently verifies the selected variant.
- Playwright remains `workers: 1`, `fullyParallel: false`, with zero retries for these runs. Repetition
  and final runs used `--max-failures=1` so a renewed environment failure stopped further Shopify load.

### Repeatability matrix

`repeatability-matrix.json` records 26/26 successful integration executions with no retries:

- Cart decrement lifecycle: desktop10/10, mobile10/10. Every iteration performed add→2→1→0,
  waited for the committed runtime event, and independently confirmed Shopify cart zero.
- Row card add/remove lifecycle: desktop1/1, mobile1/1.
- Toast burst: desktop1/1, mobile1/1.
- Editorial native variant/cart verification: desktop1/1, mobile1/1.

This matrix proves that Won cart behavior can succeed deterministically while the expected storefront
is available. It does not erase the shared environment's later inability to complete the full gate.

### Current gate results

- Compose completed for Horizon and Skeleton. Horizon wrote0 files; Skeleton synchronized the generated
  `assets/won-toast.js` plus `.won-manifest.json` from the accepted source state. No generated output was
  patched manually.
- Theme Check remains exactly at its accepted baseline: Horizon16,189 and Skeleton97, for a semantic
  delta of0 new /0 removed in both themes. Smoke discovery succeeds with484 tests in54 files. The
  machine-readable summary is `theme-check-build-final.json` in the release-gate evidence directory.
- Unqualified smoke (remediation opt-ins off):378 passed /0 failed /96 conditional skips,11.8min.
  This is diagnostic only and is not substituted for the release configuration.
- Final release configuration (`WON_REMEDIATION_QA=1`):348 passed /1 environment navigation failure /
  30 conditional skips before the stop;105 tests did not run. Playwright's JSON aggregates the latter as
  skipped (`skipped:135`). No product assertion or test assertion failed before the preview exited.
- Confirmed current product failures:0. Confirmed remaining harness failures:0. Remaining gate blocker:
  the Shopify CLI/development preview could not remain available for one complete final smoke run.

Two-tier interpretation reflects the actual architecture: the deterministic/static and completed
targeted component checks are green; the Shopify integration matrix is green for the collected sample,
but the required full Shopify-backed smoke gate is incomplete. Therefore the release verdict is
**BLOCKED BY ENVIRONMENT — no confirmed product/test regression remains, but Shopify integration cannot
currently be verified as one complete release run**.
