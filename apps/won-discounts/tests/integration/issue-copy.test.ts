import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sanitizeConfig } from "@won/core/discounts/config";

import { issueText, wordIssues, WORDED_ISSUE_CODES } from "../../app/lib/integration/issue-copy.ts";
import { CATALOGUES } from "../../app/i18n/index.ts";

// A save's `fixes` are the sanitizer's issues worded in the admin language
// from their code + params only (fix round 3: never by reading the core's
// English message) — every code the core can emit has its own cs + en
// sentence; an unknown code gets a generic sentence and is logged.

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

test("the sentence comes from code + params only: a reworded English message changes nothing", () => {
  const { issues } = sanitizeConfig({ modules: { margin: { enabled: true, global: { minMarginPercent: 12.35, maxDiscountPercent: 50 }, perCollection: [] } } });
  const rounded = issues.find((i) => i.code === "rounded_percent")!;
  const czech = issueText(rounded, "cs");
  assert.equal(issueText({ ...rounded, message: "Completely different wording 999 → 1." }, "cs"), czech);
  assert.equal(issueText({ ...rounded, message: "" }, "en"), "Margin percents have one decimal. 12.35 was rounded to 12.4, the stricter way.");
});

test("an unknown code gets the generic sentence (no English inside) and is logged with its message for support", () => {
  const logged: string[] = [];
  const texts = wordIssues([{ path: "x.y", code: "brand_new_code", message: "Something new happened." }], "cs", (line) => logged.push(line));
  assert.deepEqual(texts, ["Nastavení se při ukládání upravilo."]);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /brand_new_code at x\.y: Something new happened\./);
  // A known code without the params its sentence needs: generic too, never an unfilled {placeholder}.
  assert.equal(issueText({ path: "x", code: "clamped_percent", message: "Percent 120 is out of range 0-100; clamped to 100." }, "cs"), "Nastavení se při ukládání upravilo.");
});

test("the two duplicate_code sentences are told apart by params.reason", () => {
  assert.equal(
    issueText({ path: "p", code: "duplicate_code", message: "", params: { reason: "merged", count: 2 } }, "cs"),
    "Opakované kódy se sloučily (počet: 2). Na velikosti písmen nezáleží.",
  );
  assert.equal(
    issueText({ path: "p.codes", code: "duplicate_code", message: "", params: { reason: "taken", codes: "LETO, ZIMA", count: 2 } }, "cs"),
    "Kódy LETO, ZIMA už má dřívější sleva, z této se odebraly.",
  );
});

test("every worded code with params in its sentence gets them from the real sanitizer (no unfilled placeholder)", () => {
  const { issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          { id: "r", name: "R", method: "code", codes: ["A", "a", "B".repeat(300)], value: { kind: "percentage", percent: 150 }, target: { kind: "order" }, priority: 5000 },
        ],
      },
      margin: { enabled: true, global: { minMarginPercent: "x", maxDiscountPercent: 20.05 }, perCollection: [] },
    },
  });
  for (const issue of issues) {
    for (const locale of ["cs", "en"] as const) {
      const text = issueText(issue, locale);
      assert.doesNotMatch(text, /\{[a-z]+\}/, `${issue.code}: ${text}`);
      assert.notEqual(text, issueText({ path: "", code: "brand_new_code", message: "" }, locale), `${issue.code} got the generic sentence`);
    }
  }
});
