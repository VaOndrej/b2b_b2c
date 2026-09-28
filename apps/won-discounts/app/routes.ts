import { flatRoutes } from "@react-router/fs-routes";

import { isDevHarnessEnvironment } from "./lib/dev-harness-env";

// BUILD-TIME exclusion of the dev-only admin harness (Task 5 brief, audit
// P3-5): the harness route (app/routes/dev.preview.$.tsx) must never reach a
// non-development bundle, not just be gated at runtime. Unless NODE_ENV is
// exactly "development" or "test" (allowlist in lib/dev-harness-env.ts),
// flatRoutes' ignoredRouteFiles drops the file from the route manifest
// entirely, so the route module (and its dev-harness.server.ts fixture) are
// never imported and never end up in build/server/**. `react-router build`
// defaults NODE_ENV to "production"; "staging" and an unset NODE_ENV are
// excluded too.
// eslint-disable-next-line no-undef
const includeDevHarness = isDevHarnessEnvironment(process.env.NODE_ENV);

export default flatRoutes({
  // Patterns are matched against the path relative to `app/` (e.g.
  // "routes/dev.preview.$.tsx"), not relative to `app/routes/` — a bare
  // "dev.preview.*" pattern silently never matches.
  ignoredRouteFiles: includeDevHarness ? [] : ["routes/dev.preview.*"],
});
