import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";

import { THEME_LABEL } from "./fixtures.ts";

// Evidence of live runs: always attached to the Playwright report; also written
// to WON_DISCOUNTS_E2E_SCREENSHOT_DIR / WON_DISCOUNTS_E2E_EVIDENCE_DIR when set,
// suffixed with the matrix theme ("-horizon", "-dawn").

const SCREENSHOT_DIR = String(process.env.WON_DISCOUNTS_E2E_SCREENSHOT_DIR ?? "").trim();
const EVIDENCE_DIR = String(process.env.WON_DISCOUNTS_E2E_EVIDENCE_DIR ?? "").trim();
const suffix = () => (THEME_LABEL ? `-${THEME_LABEL.toLowerCase()}` : "");

export async function saveScreenshot(page: Page, testInfo: TestInfo, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  await saveImage(testInfo, name, await page.screenshot({ fullPage: options.fullPage ?? true }));
}

/** A PNG taken by the test itself (one element, a before / after pair). */
export async function saveImage(testInfo: TestInfo, name: string, body: Buffer): Promise<void> {
  await testInfo.attach(name, { body, contentType: "image/png" });
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(path.join(SCREENSHOT_DIR, `${name}${suffix()}.png`), body);
}

export async function saveEvidence(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await testInfo.attach(`${name}.json`, { body: json, contentType: "application/json" });
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}${suffix()}.json`), json);
}
