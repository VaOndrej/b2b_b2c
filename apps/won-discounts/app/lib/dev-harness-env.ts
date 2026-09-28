// Which NODE_ENV values may carry the dev-only admin harness (/dev/preview/*).
// An ALLOWLIST (audit P3-5): the harness is unauthenticated, so anything not
// explicitly listed — "production", "staging", "preview", unset, a typo — keeps
// it out. Shared by the build-time exclusion (app/routes.ts) and the runtime
// guard (app/lib/dev-harness.server.ts) so the two can never disagree.
// No imports on purpose: app/routes.ts loads this while the route config is read.

export const DEV_HARNESS_NODE_ENVS: readonly string[] = ["development", "test"];

export function isDevHarnessEnvironment(nodeEnv: string | undefined): boolean {
  return nodeEnv !== undefined && DEV_HARNESS_NODE_ENVS.includes(nodeEnv);
}
