import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sanitizeConfig } from "@won/core/discounts/config";

import { issueText, WORDED_ISSUE_CODES } from "../../app/lib/integration/issue-copy.ts";
import { CATALOGUES } from "../../app/i18n/index.ts";

// Fix round 2 (P1): a save's `fixes` are the sanitizer's issues worded in the
// admin language — every code the core can emit has its own cs + en sentence,
// an unknown one falls back to a generic sentence with the detail in brackets.

const CORE_CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/core/src/discounts/config");

/** Every issue code the core's config sanitizer can emit (read from its sources, like a reviewer would). */
function coreIssueCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(CORE_CONFIG).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(path.join(CORE_CONFIG, file), "utf8");
    for (const m of src.matchAll(/pushIssue\(\s*[^,]+,\s*(?:`[^`]*`|[^,]+?),\s*"([a-z_]+)"/gs)) codes.add(m[1]!);
    for (const m of src.matchAll(/code:\s*"([a-z_]+)"/g)) codes.add(m[1]!);
  }
  return [...codes].sort();
}

test("every issue code the core sanitizer can emit has its own sentence (cs + en)", () => {
  const core = coreIssueCodes();
  assert.ok(core.length >= 40, `found ${core.length} codes`);
  const missing = core.filter((code) => !WORDED_ISSUE_CODES.includes(code));
  assert.deepEqual(missing, [], "codes without a sentence");
  for (const code of core) {
    const keys = Object.keys(CATALOGUES.cs).filter((k) => k === `fix.${code}` || k.startsWith(`fix.${code}_`));
    assert.ok(keys.length > 0, `no fix.${code} key`);
  }
});

test("rounded and clamped percents read in Czech with their numbers; English too", () => {
  const { issues } = sanitizeConfig({
    modules: { margin: { enabled: true, global: { minMarginPercent: 12.35, maxDiscountPercent: 120 }, perCollection: [] } },
  });
  const rounded = issues.find((i) => i.code === "rounded_percent")!;
  const clamped = issues.find((i) => i.code === "clamped_percent")!;
  assert.ok(rounded && clamped, JSON.stringify(issues));
  assert.equal(issueText(rounded, "cs"), "Procenta marže mají jedno desetinné místo. 12.35 se zaokrouhlilo na 12.4, na přísnější stranu.");
  assert.equal(issueText(clamped, "cs"), "Procento 120 je mimo rozsah 0 až 100, uložilo se 100.");
  assert.equal(issueText(clamped, "en"), "The percent 120 is outside 0 to 100; 100 was saved.");
});

test("an unknown code (or a message whose numbers cannot be read) falls back to a generic sentence with the detail", () => {
  assert.equal(issueText({ path: "x", code: "brand_new_code", message: "Something new happened." }, "cs"), "Nastavení se při ukládání upravilo (Something new happened.).");
  assert.equal(issueText({ path: "x", code: "clamped_percent", message: "reworded" }, "en"), "The settings were adjusted when saving (reworded).");
});

test("the two duplicate_code sentences are told apart", () => {
  assert.equal(issueText({ path: "p", code: "duplicate_code", message: "2 duplicate code(s) were merged (codes are not case-sensitive)." }, "cs"), "Opakované kódy se sloučily (počet: 2). Na velikosti písmen nezáleží.");
  assert.equal(issueText({ path: "p.codes", code: "duplicate_code", message: "Code(s) LETO, ZIMA already belong to an earlier rule and were removed from this one." }, "cs"), "Kódy LETO, ZIMA už má dřívější sleva, z této se odebraly.");
});
