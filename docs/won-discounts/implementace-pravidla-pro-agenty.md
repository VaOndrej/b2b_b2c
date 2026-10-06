# Won Discounts: shared rules for the implementation wave (6 Oct 2026)

Read this whole file, then `docs/won-discounts/plan-zmen-2026-10-06.md` (the approved plan, Czech), then your own task.

Repo: /Users/ondrej/Development/WonCommerce/Apps/b2b_b2c (monorepo). App: apps/won-discounts. Core: packages/core/src/discounts. Shared kit: packages/app-kit.

## Hard rules
- Several agents work in this SAME working tree at once, each on its own files. Touch ONLY the files your task lists as yours. If you need a change in a file you do not own, do not make it: describe it in your final report.
- Shared files everybody may append to: `app/i18n/cs.ts`, `app/i18n/en.ts`, `app/components/model/types.ts`. Edit them with small targeted Edits (never rewrite or reformat the file, never reorder), re-read around your spot right before editing, and retry if an Edit fails because another agent changed the file. Add keys next to the related existing keys. Every key added to cs.ts must be added to en.ts too.
- NO git commands that change state (no commit, stash, checkout, reset, add). NO prettier, no reformatting, no import reordering: the repo has no prettier config and a formatter would rewrite whole files. Match the surrounding style (long lines are normal here).
- Do not start, stop or restart dev servers. `shopify app dev` is running; Vite hot-reloads.
- Do not write to Shopify (no live writes, no CLI deploys, no scripts with --live).
- Do not run the full gate (`npm run test:unit`): it rebuilds the Wasm and collides with other agents. Run only the test files that cover what you changed: `cd apps/won-discounts && npx tsx --test tests/path/file.test.ts`. Run `npx tsc --noEmit -p apps/won-discounts` at the end and fix errors IN YOUR FILES; errors in files owned by others are expected mid-wave — list them, do not fix them.
- Update or add unit tests for what you change (tests live in apps/won-discounts/tests; UI tests render through the dev harness, see tests/ui/harness-screens.test.ts and app/routes/dev.preview.$.tsx with its fixtures in app/lib/dev-harness.server.ts). If you change a screen's props, keep the dev harness fixtures compiling (you may edit the harness case of YOUR screen only).
- React is 18.3: on `s-*` web components React only wires `onClick`. Never use `onChange`/`onInput` on an `s-*` element; listen for native `input`/`change` on the form (the pattern in RuleEditorScreen.tsx) . Never change attributes (e.g. `error`, `value`) of an `s-*` field while the merchant may be typing in it: Polaris fields snap back to their initial value. Render messages BESIDE the field (FieldMessage / RowNote) instead.
- The server is the authority (SEC-1): every UI gate needs the matching server check; parsers ignore fields that do not apply.

## Copy rules (Czech UI, cs.ts; mirror meaning in en.ts)
- Address the merchant with VYKÁNÍ ("Vyplňte", "máte", "vaše") in every string you add or touch. (A final pass converts the rest.)
- Short, concrete sentences. No filler, no explanatory tail after a dash. No jargon: do not write "engine", "propsat/propsáno", "slevová funkce", "vložení do tématu", "appka/appce", "pravidlo" (say "sleva"). Say what the merchant should do.
- Pro features on Free: keep the amber locked look (ProFrame locked + disabled fields). Remove invented sample rows/texts ("Ukázka · …"). Above the frame there must be one sentence saying what the Pro feature is for, plus the link to the plan (the existing `ProSell` component with a `benefit`).

## Rules being enforced (P1–P9)
P2 nothing without content or action is shown. P3 a problem is marked at the field that fixes it and the header sentence links to it. P4 a selection is shown as a list with names, never only a count. P5 every text describing settings is computed from the live form. P6 what the app knows is picked, not typed. P7 only rarely-used settings sit behind a collapsible. P8 a Pro feature is finished or not visible (no "připravujeme"). P9 a control does what it says and saves it.

## Final report (your last message)
Plain text, concise: (1) what you implemented, as `file:line — change`; (2) tests you ran with their real pass/fail output summary; (3) anything from your task you did NOT do and why; (4) changes you need in files you do not own; (5) tsc errors left and who they belong to. Do not claim something works unless you ran it.
