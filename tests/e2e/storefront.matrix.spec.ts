import { registerMatrixTests } from "./support/matrix-run.ts";

// Theme-dependent Tier-1 matrix. The same tests run under the `storefront-horizon`
// (live) and `storefront-dawn` (preview) projects — the active theme is injected
// via the `themeContext` fixture, never hardcoded here.
registerMatrixTests();
