import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildDocs } from "../../scripts/gen-docs.ts";

// Drift guard for the support knowledge base (docs/nova-aplikace.md §9). The
// reference docs the support chatbot consumes are GENERATED from
// @won/core/discounts (limits, enums, defaults, the Free/Pro gate) and the admin
// copy. This test regenerates them in memory and compares against the committed
// files. If a constant changes but nobody ran `npm run docs:gen -w won-discounts`,
// the docs would silently lie to merchants, so this fails the gate instead.
// Fix: run the generator and commit the diff.
//
// It also checks the hand-written layers the way the chatbot relies on them: the
// RAG filters (`min_plan`, `status`) must be present and valid, the slug must be
// the file name, a document must sit in its layer's folder, and no cross-link may
// be dead.

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");

const expected = buildDocs();

for (const [rel, content] of Object.entries(expected)) {
  test(`generated doc is up to date: ${rel}`, () => {
    const file = path.join(docsRoot, rel);
    assert.ok(existsSync(file), `Missing generated doc ${rel}. Run: npm run docs:gen -w won-discounts`);
    assert.equal(
      readFileSync(file, "utf8"),
      content,
      `${rel} is stale. A @won/core/discounts constant or the admin copy changed without regenerating docs. ` +
        "Run: npm run docs:gen -w won-discounts (and commit the result).",
    );
  });
}

test("buildDocs is deterministic", () => {
  assert.deepEqual(buildDocs(), expected);
});

test("no stray generated doc: every reference/*.generated.md comes from buildDocs", () => {
  const onDisk = readdirSync(path.join(docsRoot, "reference"))
    .filter((f) => f.endsWith(".generated.md"))
    .map((f) => `reference/${f}`);
  const stray = onDisk.filter((rel) => !(rel in expected));
  assert.deepEqual(stray, [], `generated docs no longer produced by gen-docs.ts: ${stray.join(", ")} (delete them)`);
});

// --- Hand-written layers: frontmatter the chatbot filters on, and links -----------------------

const LAYER_FOLDER = { concept: "concepts", task: "tasks", reference: "reference", support: "support" } as const;
const PLANS = new Set(["free", "pro"]);
const STATUSES = new Set(["stable", "beta", "planned"]);
const SOURCES = new Set(["hand-written", "generated"]);
const REQUIRED = ["title", "slug", "layer", "feature", "min_plan", "status", "source", "lang", "summary", "keywords"] as const;

interface Doc {
  rel: string;
  fields: Record<string, string>;
  body: string;
}

function parse(rel: string): Doc {
  const raw = readFileSync(path.join(docsRoot, rel), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(match, `${rel}: no frontmatter block`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { rel, fields, body: match[2] };
}

const docs: Doc[] = Object.values(LAYER_FOLDER).flatMap((folder) =>
  readdirSync(path.join(docsRoot, folder))
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(`${folder}/${f}`)),
);

test("the corpus has every layer", () => {
  for (const folder of Object.values(LAYER_FOLDER)) {
    assert.ok(docs.some((d) => d.rel.startsWith(`${folder}/`)), `no documents in docs/${folder}/`);
  }
});

for (const doc of docs) {
  test(`frontmatter is complete and valid: ${doc.rel}`, () => {
    const f = doc.fields;
    for (const key of REQUIRED) assert.ok(f[key], `${doc.rel}: missing \`${key}\``);
    assert.ok(f.layer in LAYER_FOLDER, `${doc.rel}: unknown layer \`${f.layer}\``);
    assert.equal(doc.rel.split("/")[0], LAYER_FOLDER[f.layer as keyof typeof LAYER_FOLDER], `${doc.rel}: wrong folder for its layer`);
    assert.ok(PLANS.has(f.min_plan), `${doc.rel}: unknown min_plan \`${f.min_plan}\``);
    assert.ok(STATUSES.has(f.status), `${doc.rel}: unknown status \`${f.status}\``);
    assert.ok(SOURCES.has(f.source), `${doc.rel}: unknown source \`${f.source}\``);
    assert.equal(f.source === "generated", doc.rel.endsWith(".generated.md"), `${doc.rel}: only *.generated.md is source: generated`);
    assert.equal(f.slug, path.basename(doc.rel).replace(/\.generated\.md$|\.md$/, ""), `${doc.rel}: slug must equal the file name`);
    assert.match(f.keywords, /^\[.+\]$/, `${doc.rel}: keywords must be a non-empty [list]`);
    assert.ok(f.summary.length <= 220, `${doc.rel}: summary is ${f.summary.length} chars, keep it one sentence`);
    // A plain YAML scalar must not contain ": " (a strict parser reads it as a mapping).
    for (const key of ["title", "summary"] as const) assert.ok(!f[key].includes(": "), `${doc.rel}: \`${key}\` contains ": "`);
  });
}

test("slugs are unique", () => {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const prev = seen.get(doc.fields.slug);
    assert.equal(prev, undefined, `duplicate slug \`${doc.fields.slug}\`: ${prev} and ${doc.rel}`);
    seen.set(doc.fields.slug, doc.rel);
  }
});

test("every relative link between docs resolves", () => {
  const slugsByFolder = new Map<string, Set<string>>();
  for (const doc of docs) {
    const folder = doc.rel.split("/")[0];
    if (!slugsByFolder.has(folder)) slugsByFolder.set(folder, new Set());
    slugsByFolder.get(folder)?.add(doc.fields.slug);
  }
  const broken: string[] = [];
  for (const doc of docs) {
    for (const m of doc.body.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const folder = doc.rel.split("/")[0];
      const ok = target.endsWith(".md")
        ? existsSync(path.resolve(docsRoot, folder, target))
        : !target.includes("/") && (slugsByFolder.get(folder)?.has(target) ?? false);
      if (!ok) broken.push(`${doc.rel} → ${m[1]}`);
    }
  }
  assert.deepEqual(broken, [], `broken doc links:\n${broken.join("\n")}`);
});
