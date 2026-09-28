// One Admin GraphQL call with the platform rules applied (API-3, REL-1, REL-2):
//   - every call has a timeout, so nothing waits forever;
//   - THROTTLED is retried with exponential backoff (the request was not run);
//   - a transport failure of a READ is retried; of a MUTATION never (the write
//     may have landed — the caller checks the store before trying again);
//   - the result is always one of: data, a GraphQL/user error, or a transport
//     failure. Nothing throws.

import { GQL, type GqlName } from "./documents.ts";
import type { AdminClient } from "./types.ts";

export interface RequestOptions {
  /** Injected in tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Per call. Default 30 s. */
  timeoutMs?: number;
  /** Attempts for THROTTLED / read transport failures. Default 4. */
  maxAttempts?: number;
  /** First backoff delay; doubles per attempt. Default 1 000 ms. */
  backoffMs?: number;
}

export type GqlResult =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw GraphQL payload, narrowed by the caller
  | { ok: true; data: any }
  | { ok: false; kind: "graphql" | "throttled" | "transport"; message: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer from Shopify within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorList(errors: unknown): { message: string; code: string | null }[] {
  const list = Array.isArray(errors) ? errors : errors ? [errors] : [];
  return list.map((e) => {
    const record = (e && typeof e === "object" ? e : {}) as { message?: unknown; extensions?: { code?: unknown } };
    return {
      message: typeof record.message === "string" ? record.message : String(e),
      code: typeof record.extensions?.code === "string" ? record.extensions.code : null,
    };
  });
}

function isThrottledText(text: string): boolean {
  return /throttled/i.test(text);
}

/** Run `GQL[name]` through `client`. See the file header for the retry rules. */
export async function runGql(
  client: AdminClient,
  name: GqlName,
  variables: Record<string, unknown> | undefined,
  options: RequestOptions = {},
): Promise<GqlResult> {
  const query = GQL[name];
  const isMutation = query.trimStart().startsWith("mutation");
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const backoffMs = options.backoffMs ?? 1_000;

  let last: GqlResult = { ok: false, kind: "transport", message: "not sent" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retry = false;
    let retryAfterMs: number | null = null;
    try {
      const response = await withTimeout(client.graphql(query, variables), timeoutMs);
      const errors = errorList(response?.errors);
      if (errors.length === 0) return { ok: true, data: response?.data ?? {} };
      const throttled = errors.some((e) => e.code === "THROTTLED" || isThrottledText(e.message));
      last = {
        ok: false,
        kind: throttled ? "throttled" : "graphql",
        message: errors.map((e) => e.message).join("; ").slice(0, 500),
      };
      retry = throttled;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // HTTP 429 (AdminTransportError.status in app/lib/admin-client.server.ts):
      // rate limited before execution, so even a mutation is safe to resend.
      const status = (error as { status?: unknown } | null)?.status;
      const throttled = status === 429 || isThrottledText(message);
      last = { ok: false, kind: throttled ? "throttled" : "transport", message: message.slice(0, 500) };
      retry = throttled || !isMutation;
      const hint = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
      retryAfterMs = typeof hint === "number" && hint > 0 ? hint : null;
    }
    if (!retry || attempt === maxAttempts) return last;
    await sleep(retryAfterMs ?? backoffMs * 2 ** (attempt - 1));
  }
  return last;
}

export interface UserError {
  field?: string[] | null;
  code?: string | null;
  message: string;
}

/** userErrors of a mutation payload, normalized (empty when there are none). */
export function userErrorsOf(payload: unknown): UserError[] {
  const list = (payload as { userErrors?: unknown } | null | undefined)?.userErrors;
  if (!Array.isArray(list)) return [];
  return list.map((e) => {
    const record = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    return {
      field: Array.isArray(record.field) ? (record.field as string[]) : null,
      code: typeof record.code === "string" ? record.code : null,
      message: typeof record.message === "string" ? record.message : "Unknown error",
    };
  });
}

export function describeUserErrors(errors: UserError[]): string {
  return errors
    .map((e) => (e.field && e.field.length > 0 ? `${e.field.join(".")}: ${e.message}` : e.message))
    .join("; ")
    .slice(0, 500);
}
