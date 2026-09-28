// Kept for the existing relative imports from tests/smoke/*.spec.ts. The real
// implementation moved to @won/testing/playwright (audit fix round 3) so any app
// can reuse it, e.g. scoped to its own embed root via
// assertResponsiveSane(page, { root: '#my-app-root' }). This file re-exports the
// same functions, unchanged, so nothing here needs to know that.
export {
  assertResponsiveSane,
  assertHeadingBodyAlignment,
  assertCarousel,
  type AssertResponsiveSaneOptions,
} from '@won/testing/playwright';
