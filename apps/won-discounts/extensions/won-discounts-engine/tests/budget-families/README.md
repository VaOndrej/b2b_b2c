# Constructed budget families (instruction limit, MVP 3–4)

Measurement tools, not tests. The inputs are too large for git (493 MB): the MVP 3 cap-550 families (t-top, t-focus,
t-climbs, t-every, t-fixtures-room; 3 320 inputs at the MessagePack input limit) are archived locally in
`.superpowers/sdd/2026-10-01-won-discounts-mvp4/budget-families-cap550.tar.gz` (gitignored; `tar -xzf … -C <dir>` →
`<dir>/fam/<family>/*.input.json`). How they were built: `.superpowers/sdd/2026-09-30-won-discounts-mvp3/task-2-report.md`
("Cap measurement").

- `batch.mjs <out.tsv> <dir>...` — every `*.input.json` through a Wasm (`WASM=<path>`, `JOBS=n`), TS parity per input,
  % of Shopify's line-scaled limit; first lines of stdout = max and counts ≥ 100 / ≥ 90.
- `rewards-variants.mjs <outDir> <familyDir>...` — MVP 4: each input × reward variants (the costliest rewards payload
  that fits 9 000 B, room from `marketCountries`; `SMALL=1`: 1 tier in the cart currency), trimmed back to the input limit.

Results so far (README of the function, "Rewards"): MVP 3 build 98.67 %; MVP 4 build 99.21 % without rewards, 99.32 % with
them. Re-measure after every engine change that reads more per line (MVP 5: first step).
