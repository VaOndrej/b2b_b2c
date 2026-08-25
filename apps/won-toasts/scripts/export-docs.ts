/**
 * Support-docs corpus export for RAG ingestion.
 *
 * Turns docs/**\/*.md into docs/dist/corpus.jsonl — one JSON object per RETRIEVAL
 * CHUNK, not per file. A chatbot retrieves passages, so the chunk (not the
 * document) is the real unit: each one carries the document's filter metadata
 * plus its own heading path, so an answer can cite "Anti-spam and how often
 * toasts appear → Cap — how much is too much" rather than a whole page.
 *
 *   npm run docs:export -w won-toasts
 *
 * `buildCorpus()` is a pure function of the docs tree (no wall-clock, no env) so
 * tests/docs/docs-corpus.test.ts can diff committed vs. actual and fail the gate
 * when a document changes without re-exporting. That matters more here than for
 * the index: a stale corpus is what the chatbot would actually answer from.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { DOCS_DIR, collectDocs, type DocMeta } from "./gen-docs-index.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = join(scriptDir, "..", "docs", "dist");
export const CORPUS_FILE = join(DIST_DIR, "corpus.jsonl");

/**
 * Hard ceiling on a chunk, in characters. Chosen so a chunk fits comfortably in
 * an embedding window with room for the heading path, and so a retrieved passage
 * is small enough that the model answers from it rather than skimming it.
 */
export const MAX_CHUNK_CHARS = 1500;

export interface Chunk {
  /** Stable id: never reuse across content changes of a different section. */
  id: string;
  doc_slug: string;
  doc_title: string;
  /** "Document title › Section heading" — what an answer cites. */
  heading_path: string;
  section: string | null;
  /** 0-based position of the chunk within its document. */
  position: number;
  layer: string;
  feature: string;
  min_plan: string;
  status: string;
  lang: string;
  source: string;
  path: string;
  keywords: string[];
  summary: string;
  text: string;
}

function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_[\]()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Body of a document: everything after the frontmatter and the AUTO banner. */
function bodyOf(raw: string): string {
  const end = raw.indexOf("\n---", 4);
  const body = end === -1 ? raw : raw.slice(end + 4);
  return body.replace(/^<!--[\s\S]*?-->\n/m, "").trim();
}

/** Split a long section on paragraph boundaries, never mid-sentence. */
function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const parts: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > MAX_CHUNK_CHARS && current) {
      parts.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  // A single paragraph over the ceiling is a writing problem, not a splitting
  // problem — surfaced by the test rather than silently hard-cut here.
  return parts;
}

/** Sections of one document: the H1 preamble, then one per H2. */
function sectionsOf(body: string): { heading: string | null; text: string }[] {
  const lines = body.split("\n");
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) out.push({ heading, text });
    buffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ")) continue; // the H1 is the doc title already
    if (line.startsWith("## ")) {
      flush();
      heading = line.slice(3).trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

export function chunksFor(doc: DocMeta, raw: string): Chunk[] {
  const chunks: Chunk[] = [];
  let position = 0;
  for (const section of sectionsOf(bodyOf(raw))) {
    for (const [i, text] of splitLong(section.text).entries()) {
      const key = section.heading ? slugifyHeading(section.heading) : "intro";
      chunks.push({
        id: `${doc.slug}#${key}${i > 0 ? `-${i + 1}` : ""}`,
        doc_slug: doc.slug,
        doc_title: doc.title,
        heading_path: section.heading ? `${doc.title} › ${section.heading}` : doc.title,
        section: section.heading,
        position: position++,
        layer: doc.layer,
        feature: doc.feature,
        min_plan: doc.min_plan,
        status: doc.status,
        lang: doc.lang,
        source: doc.source,
        path: doc.path,
        keywords: doc.keywords,
        summary: doc.summary,
        text,
      });
    }
  }
  return chunks;
}

/** Pure: every chunk in the corpus, document order then section order. */
export function buildCorpus(): Chunk[] {
  return collectDocs().flatMap((doc) =>
    chunksFor(doc, readFileSync(join(DOCS_DIR, doc.path), "utf8")),
  );
}

/** Pure: the exact file content of docs/dist/corpus.jsonl. */
export function buildCorpusFile(): string {
  return buildCorpus().map((c) => JSON.stringify(c)).join("\n") + "\n";
}

function main(): void {
  mkdirSync(DIST_DIR, { recursive: true });
  const content = buildCorpusFile();
  writeFileSync(CORPUS_FILE, content, "utf8");
  const count = content.trimEnd().split("\n").length;
  console.log(`wrote ${relative(process.cwd(), CORPUS_FILE)} (${count} chunks)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
