import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  CORPUS_FILE,
  MAX_CHUNK_CHARS,
  buildCorpus,
  buildCorpusFile,
} from "../../scripts/export-docs.ts";
import {
  DOCS_DIR,
  INDEX_FILE,
  buildIndex,
  collectDocs,
  parseFrontmatter,
} from "../../scripts/gen-docs-index.ts";

// Corpus guard for the support knowledge base. The docs are ingested by a RAG
// chatbot that FILTERS on frontmatter — a missing `min_plan` would leak Pro
// answers to Free merchants, a missing `status` would let unfinished material be
// answered as fact, and a dead cross-link is a dead end mid-answer. None of that
// is visible by reading a single file, so it is asserted here instead.

const LAYERS = new Set(["concept", "task", "reference", "support"]);
const PLANS = new Set(["free", "pro"]);
const STATUSES = new Set(["stable", "beta", "planned"]);
const SOURCES = new Set(["hand-written", "generated"]);

const docs = collectDocs();

test("the corpus is not empty", () => {
  assert.ok(docs.length > 0, "no documents found under docs/");
});

for (const doc of docs) {
  test(`frontmatter is complete and valid: ${doc.path}`, () => {
    for (const field of ["title", "slug", "layer", "feature", "min_plan", "status", "lang", "source", "summary"] as const) {
      assert.ok(doc[field], `${doc.path}: missing frontmatter field \`${field}\``);
    }
    assert.ok(LAYERS.has(doc.layer), `${doc.path}: unknown layer \`${doc.layer}\``);
    assert.ok(PLANS.has(doc.min_plan), `${doc.path}: unknown min_plan \`${doc.min_plan}\``);
    assert.ok(STATUSES.has(doc.status), `${doc.path}: unknown status \`${doc.status}\``);
    assert.ok(SOURCES.has(doc.source), `${doc.path}: unknown source \`${doc.source}\``);
    assert.ok(doc.keywords.length > 0, `${doc.path}: needs keywords for retrieval`);
    assert.ok(
      doc.summary.length <= 220,
      `${doc.path}: summary is ${doc.summary.length} chars — keep it one retrievable sentence`,
    );
  });

  test(`slug matches the file name: ${doc.path}`, () => {
    const base = path.basename(doc.path).replace(/\.generated\.md$|\.md$/, "");
    assert.equal(doc.slug, base, `${doc.path}: slug must equal the file name (stable chunk id)`);
  });

  test(`a document's folder matches its layer: ${doc.path}`, () => {
    const folder = doc.path.split("/")[0];
    const expected = { concept: "concepts", task: "tasks", reference: "reference", support: "support" }[
      doc.layer
    ];
    assert.equal(folder, expected, `${doc.path}: layer \`${doc.layer}\` belongs in \`${expected}/\``);
  });
}

test("slugs are unique across the corpus", () => {
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const prev = seen.get(doc.slug);
    assert.equal(prev, undefined, `duplicate slug \`${doc.slug}\`: ${prev} and ${doc.path}`);
    seen.set(doc.slug, doc.path);
  }
});

test("every relative markdown link resolves", () => {
  const slugs = new Set(docs.map((d) => d.slug));
  const broken: string[] = [];
  for (const doc of docs) {
    const abs = path.join(DOCS_DIR, doc.path);
    const body = readFileSync(abs, "utf8").split("\n---", 2)[1] ?? "";
    for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|#|mailto:)/.test(target)) continue;
      const clean = target.split("#")[0];
      if (!clean) continue;
      if (clean.endsWith(".md")) {
        if (!existsSync(path.resolve(path.dirname(abs), clean))) {
          broken.push(`${doc.path} → ${target} (file not found)`);
        }
      } else if (!slugs.has(path.basename(clean))) {
        // Same-folder slug link, e.g. [milestones](milestones).
        broken.push(`${doc.path} → ${target} (no such slug)`);
      }
    }
  }
  assert.deepEqual(broken, [], `broken doc links:\n${broken.join("\n")}`);
});

test("the corpus index is up to date", () => {
  const committed = readFileSync(path.join(DOCS_DIR, INDEX_FILE), "utf8");
  assert.equal(
    committed,
    buildIndex(),
    "docs/index.generated.md is stale. Run: npm run docs:gen -w won-toasts (and commit the result).",
  );
});

test("generated reference docs are never hand-edited", () => {
  for (const doc of docs.filter((d) => d.path.endsWith(".generated.md"))) {
    const raw = readFileSync(path.join(DOCS_DIR, doc.path), "utf8");
    assert.match(
      raw,
      /AUTO-GENERATED/,
      `${doc.path} lost its AUTO-GENERATED banner — was it hand-edited?`,
    );
    assert.equal(parseFrontmatter(raw).source, "generated");
  }
});

// --- RAG export -------------------------------------------------------------
// The chatbot answers from docs/dist/corpus.jsonl, not from the markdown. A
// stale or malformed export is therefore a wrong ANSWER, not a formatting nit —
// which is why the chunk file is committed and diffed like the generated docs.

test("the exported corpus is up to date", () => {
  const committed = readFileSync(CORPUS_FILE, "utf8");
  assert.equal(
    committed,
    buildCorpusFile(),
    "docs/dist/corpus.jsonl is stale. Run: npm run docs:gen -w won-toasts (and commit the result).",
  );
});

test("every document produced at least one chunk", () => {
  const chunked = new Set(buildCorpus().map((c) => c.doc_slug));
  const missing = docs.map((d) => d.slug).filter((s) => !chunked.has(s));
  assert.deepEqual(missing, [], `documents that exported no chunk: ${missing.join(", ")}`);
});

test("chunk ids are unique and stable-looking", () => {
  const seen = new Set<string>();
  for (const chunk of buildCorpus()) {
    assert.ok(!seen.has(chunk.id), `duplicate chunk id \`${chunk.id}\``);
    seen.add(chunk.id);
    assert.match(chunk.id, /^[a-z0-9-]+#[a-z0-9-]+$/, `unusable chunk id \`${chunk.id}\``);
  }
});

test("no chunk exceeds the retrieval size ceiling", () => {
  const over = buildCorpus()
    .filter((c) => c.text.length > MAX_CHUNK_CHARS)
    .map((c) => `${c.id} (${c.text.length} chars)`);
  assert.deepEqual(
    over,
    [],
    `these sections are a single paragraph over ${MAX_CHUNK_CHARS} chars — split the prose, ` +
      `don't raise the ceiling:\n${over.join("\n")}`,
  );
});

test("every chunk carries the filters the chatbot needs", () => {
  for (const chunk of buildCorpus()) {
    assert.ok(chunk.text.trim(), `${chunk.id}: empty chunk`);
    assert.ok(PLANS.has(chunk.min_plan), `${chunk.id}: unusable min_plan`);
    assert.ok(STATUSES.has(chunk.status), `${chunk.id}: unusable status`);
    assert.ok(chunk.lang, `${chunk.id}: missing lang`);
    assert.ok(chunk.heading_path, `${chunk.id}: missing heading path to cite`);
  }
});

test("the export is deterministic", () => {
  assert.equal(buildCorpusFile(), buildCorpusFile());
});
