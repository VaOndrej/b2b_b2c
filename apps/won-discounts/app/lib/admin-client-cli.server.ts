// AdminClient over `shopify app execute` (runs as the app, no admin token), for
// scripts and live tests — the same transport the MVP 0 prototypes used
// (scripts/prototypes/lib.mjs `shopifyExecute`). Mutations are refused on any
// store but the shared dev store; reads work anywhere the CLI is authorised.
//
// The CLI writes only `data` to --output-file. On GraphQL errors it prints
// "GraphQL operation failed." with the response's `errors` JSON inside a box,
// writes NO output file and still exits 0 (verified live, CLI 3.92.1). So:
//   - a GraphQL error box → a result with those `errors` (THROTTLED among them
//     is retryable, the rest is not);
//   - a real HTTP status phrase ("503 Service Unavailable", "status code 429",
//     "HTTP/1.1 502") or a network error → AdminTransportError;
//   - anything else → a GraphQL error result (not retried).
// A bare 3-digit number (e.g. `"line": 512` in an error location) is never
// read as an HTTP status (M8).

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AdminTransportError, normalizeGraphQLErrors, type AdminClient, type GraphQLErrorLike } from "./admin-client.server";

/** The shared development store: the only store the CLI client may mutate. */
export const DEV_STORE = "b2b-b2c-store-development.myshopify.com";
export const CLI_API_VERSION = "2026-04";

export type CliExec = (
  command: string,
  args: readonly string[],
  options: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface CliAdminClientOptions {
  /** The app directory (`--path`), e.g. apps/won-discounts. */
  appDir: string;
  /** Working directory for the CLI (default: the process cwd). */
  cwd?: string;
  store?: string;
  version?: string;
  /** Where query/variable/output files go (default: OS temp). */
  tmpDir?: string;
  /** Injectable for tests; default spawns `npx` in its own process group. */
  exec?: CliExec;
}

const MAX_OUTPUT_CHARS = 1024 * 1024;

const defaultExec: CliExec = (command, args, options) =>
  new Promise((resolve, reject) => {
    // Own process group (`detached`): a Ctrl+C in the terminal reaches the
    // calling script (which can finish its bookkeeping), never a mutation half-way.
    const child = spawn(command, [...args], { cwd: options.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_OUTPUT_CHARS);
    });
    child.on("error", (error) => reject(Object.assign(error, { stdout, stderr })));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${command} exited with ${code}`), { stdout, stderr }));
    });
  });

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

/** First keyword of the document, ignoring comments/whitespace. */
export function operationKind(query: string): "query" | "mutation" | "subscription" {
  const stripped = query.replace(/#[^\n]*/g, "").trim();
  if (stripped.startsWith("mutation")) return "mutation";
  if (stripped.startsWith("subscription")) return "subscription";
  return "query";
}

const HTTP_STATUS_RE =
  /\b(?:status(?:\s*code)?\s*[:=]?\s*|HTTP\/\d(?:\.\d)?\s+|HTTP\s+)(429|5\d\d)\b|\b(429|5\d\d)\s+(?:Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i;

/** The `errors` of a "GraphQL operation failed." box in the CLI output, or null when there is none. */
export function parseCliGraphqlErrors(output: string): GraphQLErrorLike[] | null {
  const marker = output.indexOf("GraphQL operation failed");
  if (marker === -1) return null;
  const body = output
    .slice(marker)
    .split("\n")
    .map((line) => line.replace(/^\s*[│|]\s?/, "").replace(/\s*[│|]\s*$/, ""))
    .join("\n");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as { errors?: unknown };
      const errors = normalizeGraphQLErrors(parsed.errors);
      if (errors.length > 0) return errors;
    } catch {
      // the box wrapped a long line: fall back to the messages and codes
    }
  }
  const messages = [...body.matchAll(/"message":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
  const throttled = /THROTTLED/.test(body);
  const list = (messages.length ? messages : ["GraphQL operation failed"]).map((message) => ({ message }));
  return throttled ? [{ message: "Throttled", extensions: { code: "THROTTLED" } }, ...list] : list;
}

function classifyFailure(output: string, error: unknown): AdminTransportError | { errors: GraphQLErrorLike[] } {
  const graphql = parseCliGraphqlErrors(output);
  if (graphql) return { errors: graphql };
  if (/\bTHROTTLED\b|\bThrottled\b/.test(output)) return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
  const status = HTTP_STATUS_RE.exec(output);
  if (status) {
    const code = Number(status[1] ?? status[2]);
    return new AdminTransportError(`shopify app execute: HTTP ${code}`, { status: code, cause: error });
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i.test(output)) {
    return new AdminTransportError("shopify app execute: network failure", { status: null, cause: error });
  }
  return { errors: [{ message: output.trim().slice(-2000) || "shopify app execute failed" }] };
}

export function createCliAdminClient(options: CliAdminClientOptions): AdminClient {
  const store = options.store ?? DEV_STORE;
  const version = options.version ?? CLI_API_VERSION;
  const exec = options.exec ?? defaultExec;
  const baseDir = options.tmpDir ?? path.join(tmpdir(), "won-discounts-cli-admin");

  return {
    async graphql(query, variables) {
      if (operationKind(query) === "mutation" && store !== DEV_STORE) {
        throw new Error(`refusing to run a mutation on ${store}: the CLI admin client mutates only the dev store ${DEV_STORE}`);
      }
      await mkdir(baseDir, { recursive: true });
      const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      const queryFile = path.join(baseDir, `${stamp}.graphql`);
      const variableFile = path.join(baseDir, `${stamp}.variables.json`);
      const outputFile = path.join(baseDir, `${stamp}.out.json`);
      const args = [
        "shopify", "app", "execute",
        "--path", options.appDir,
        "--store", store,
        "--version", version,
        "--query-file", queryFile,
        "--output-file", outputFile,
        "--no-color",
      ];
      try {
        await writeFile(queryFile, query);
        if (variables !== undefined) {
          await writeFile(variableFile, JSON.stringify(variables));
          args.push("--variable-file", variableFile);
        }
        let output: string;
        try {
          const result = await exec("npx", args, { cwd: options.cwd });
          output = stripAnsi(`${result.stdout}\n${result.stderr}`);
        } catch (error) {
          const e = (error ?? {}) as { stdout?: unknown; stderr?: unknown; message?: unknown };
          const failure = classifyFailure(stripAnsi(`${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`), error);
          if (failure instanceof AdminTransportError) throw failure;
          return { data: null, errors: failure.errors };
        }
        let text: string;
        try {
          text = await readFile(outputFile, "utf8");
        } catch {
          // Exit 0 without an output file = the CLI printed a GraphQL error box.
          const failure = classifyFailure(output, null);
          if (failure instanceof AdminTransportError) throw failure;
          return { data: null, errors: failure.errors };
        }
        return { data: JSON.parse(text) };
      } finally {
        await Promise.all([queryFile, variableFile, outputFile].map((file) => rm(file, { force: true })));
      }
    },
  };
}
