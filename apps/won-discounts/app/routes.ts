import { flatRoutes } from "@react-router/fs-routes";

// BUILD-TIME exclusion of the dev-only admin harness (Task 5 brief): the
// harness route (app/routes/dev.preview.$.tsx) must never reach a production
// bundle, not just be gated at runtime. flatRoutes' ignoredRouteFiles drops
// the file from the route manifest entirely when NODE_ENV === "production",
// so the route module (and its dev-harness.server.ts fixture) are never
// imported and never end up in build/server/**.
// eslint-disable-next-line no-undef
const isProductionBuild = process.env.NODE_ENV === "production";

export default flatRoutes({
  // Patterns are matched against the path relative to `app/` (e.g.
  // "routes/dev.preview.$.tsx"), not relative to `app/routes/` — a bare
  // "dev.preview.*" pattern silently never matches.
  ignoredRouteFiles: isProductionBuild ? ["routes/dev.preview.*"] : [],
});
