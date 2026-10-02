// The theme matrix running only the tests matching WON_E2E_GREP in WON_E2E_SPEC (default: every spec) —
// scripts/e2e/runbook/debug-run.sh. Everything else as e2e.app.config.mjs.
import process from "node:process";
import base from "./e2e.app.config.mjs";

export default {
  ...base,
  testCommand: ["npx", "playwright", "test", "--config=playwright.config.ts", ...(process.env.WON_E2E_SPEC ? [process.env.WON_E2E_SPEC] : []), "--grep", process.env.WON_E2E_GREP || "."],
};
