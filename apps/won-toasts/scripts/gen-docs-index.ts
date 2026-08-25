/**
 * Support-docs corpus index generator.
 *
 * Walks apps/won-toasts/docs and writes docs/index.generated.md — one row per
 * document with the frontmatter fields the support chatbot filters on (layer,
 * feature, min_plan, status, lang). The RAG ingestion reads this file to know
 * what the corpus contains without parsing every document first.
 *
 *   npm run docs:gen -w won-toasts     # writes reference/*.generated.md + this
 *
 * `buildIndex()` is a pure function of the docs tree (no wall-clock, no env), so
 * tests/docs/docs-corpus.test.ts can diff committed vs. actual and fail the gate
 * when a document is added or its frontmatter changes without regenerating.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const DOCS_DIR = join(scriptDir, "..", "docs");

export const INDEX_FILE = "index.generated.md";

/**
 * Files that live under docs/ but are NOT merchant-facing corpus: the human
 * README and the operator guide for the support bot. They carry no frontmatter
 * and must never be retrievable as an answer.
 */
const NON_CORPUS = new Set([INDEX_FILE, "README.md", "CHATBOT.md"]);

export interface DocMeta {
  path: string;
  title: string;
  slug: string;
  layer: string;
  feature: string;
  min_plan: string;
  status: string;
  lang: string;
  source: string;
  summary: string;
  keywords: string[];
}

/** Minimal frontmatter reader — the docs use a flat, quoted-free subset. */
export function parseFrontmatter(raw: string): Record<string, string> {
  if (!raw.startsWith("---\n")) return {};
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return {};
  const out: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, acc);
    else if (entry.endsWith(".md") && !NON_CORPUS.has(entry)) {
      acc.push(abs);
    }
  }
  return acc;
}

/** Every document in the corpus, sorted by path (deterministic). */
export function collectDocs(): DocMeta[] {
  return walk(DOCS_DIR).map((abs) => {
    const fm = parseFrontmatter(readFileSync(abs, "utf8"));
    const kw = (fm.keywords ?? "").replace(/^\[|\]$/g, "").trim();
    return {
      path: relative(DOCS_DIR, abs).split("\\").join("/"),
      title: fm.title ?? "",
      slug: fm.slug ?? "",
      layer: fm.layer ?? "",
      feature: fm.feature ?? "",
      min_plan: fm.min_plan ?? "",
      status: fm.status ?? "",
      lang: fm.lang ?? "",
      source: fm.source ?? "",
      summary: fm.summary ?? "",
      keywords: kw ? kw.split(",").map((k) => k.trim()).filter(Boolean) : [],
    };
  });
}

/** Pure: the full content of docs/index.generated.md. */
export function buildIndex(): string {
  const docs = collectDocs();
  const byLayer = (layer: string) => docs.filter((d) => d.layer === layer);
  const rows = (list: DocMeta[]) =>
    list
      .map(
        (d) =>
          `| [${d.title}](${d.path}) | \`${d.slug}\` | ${d.feature} | ${d.min_plan} | ${d.status} | ${d.summary} |`,
      )
      .join("\n");

  const section = (layer: string, heading: string, blurb: string) => {
    const list = byLayer(layer);
    if (!list.length) return "";
    return `## ${heading}

${blurb}

| Document | Slug | Feature | Plan | Status | Summary |
|---|---|---|---|---|---|
${rows(list)}
`;
  };

  return `---
title: Documentation index
slug: index
layer: reference
feature: core
min_plan: free
status: stable
source: generated
generated_from: 'docs/**/*.md'
lang: en
keywords: [index, contents, corpus, manifest, all documents]
summary: Every document in the Won Toasts knowledge base with the metadata the support chatbot filters on.
---

<!-- AUTO-GENERATED from the docs tree — DO NOT EDIT. Run \`npm run docs:gen -w won-toasts\` to refresh. -->

# Documentation index

${docs.length} documents. Chatbot filters: \`min_plan\` hides Pro-only answers from
Free merchants, \`status\` keeps \`planned\`/\`beta\` material out of answers, \`lang\`
selects the answer language, \`layer\` weights concepts over tasks for "how does it
work" questions.

${section("concept", "Concepts", "How it works and why — the answers to most support questions. Stable across UI changes.")}
${section("task", "Tasks", "Step-by-step: how do I set X up.")}
${section("reference", "Reference", "Exact values, generated from code. Never hand-edited.")}
${section("support", "Support", "Troubleshooting and FAQ.")}`.replace(/\n{3,}/g, "\n\n") + "\n";
}

function main(): void {
  const abs = join(DOCS_DIR, INDEX_FILE);
  writeFileSync(abs, buildIndex(), "utf8");
  console.log(`wrote ${relative(process.cwd(), abs)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
