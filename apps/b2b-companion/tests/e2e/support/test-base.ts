import { createStorefrontTest, expect } from "@won/testing/playwright";

/**
 * Margin Guard owns only the proxy path that needs the local theme-dev MIME
 * workaround. The fixture implementation itself is shared by every WonApp.
 */
export const test = createStorefrontTest({
  javaScriptProxyPaths: ["/apps/margin-guard/visibility-script"],
});

export { expect };
