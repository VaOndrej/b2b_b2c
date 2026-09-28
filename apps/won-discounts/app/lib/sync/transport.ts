// Retry policy for every sync request (doctrine API-3, spec §9 "idempotentní,
// s retry/backoff"):
//   - THROTTLED (GraphQL cost limit) and HTTP 429: nothing was executed → retry
//     with exponential backoff (base × 2^(attempt−1), capped; Retry-After wins);
//   - HTTP 5xx / network: the request MAY have been applied. Idempotent calls
//     (reads, metafieldsSet, updates, deletes) are retried the same way.
//     Non-idempotent ones (creates) first run `recover` — a lookup of what the
//     lost attempt would have created — and are re-sent only when nothing is
//     found, so a lost response never leaves a duplicate node;
//   - any other GraphQL error: not retried (a retry cannot fix it).
// userErrors are part of the payload (data) and are handled by the caller.

import { AdminTransportError, isThrottled, type AdminClient } from "../admin-client.server";
import { GQL, type GqlName } from "./graphql";
import type { RetryOptions, SyncLogger } from "./types";

export const DEFAULT_RETRY: RetryOptions = {
  attempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  pollAttempts: 10,
  pollDelayMs: 500,
};

export class SyncCallError extends Error {
  readonly kind: "graphql" | "transport" | "throttled" | "empty";

  constructor(message: string, kind: SyncCallError["kind"]) {
    super(message);
    this.name = "SyncCallError";
    this.kind = kind;
  }
}

export interface CallOptions<T> {
  /** False for creates: an ambiguous failure (5xx/network) is never blindly re-sent. */
  idempotent?: boolean;
  /** Non-idempotent calls: find what an ambiguous attempt created (null = nothing, safe to re-send). */
  recover?: () => Promise<T | null>;
}

export interface UserErrorLike {
  field?: readonly string[] | null;
  message: string;
  code?: string | null;
}

/** "field.path: message; …" or null when there are none. */
export function userErrorText(errors: readonly UserErrorLike[] | null | undefined): string | null {
  if (!errors || errors.length === 0) return null;
  return errors.map((e) => (e.field && e.field.length ? `${e.field.join(".")}: ${e.message}` : e.message)).join("; ");
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Transport {
  readonly retry: RetryOptions;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private readonly client: AdminClient,
    retry: Partial<RetryOptions> | undefined,
    sleep: ((ms: number) => Promise<void>) | undefined,
    private readonly logger: SyncLogger,
  ) {
    this.retry = { ...DEFAULT_RETRY, ...(retry ?? {}) };
    this.sleepFn = sleep ?? defaultSleep;
  }

  sleep(ms: number): Promise<void> {
    return this.sleepFn(ms);
  }

  private delay(attempt: number, retryAfterMs: number | null): number {
    const backoff = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
    return retryAfterMs !== null ? Math.max(backoff, retryAfterMs) : backoff;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async call<T = any>(name: GqlName, variables?: Record<string, unknown>, options: CallOptions<T> = {}): Promise<T> {
    const idempotent = options.idempotent ?? true;
    const attempts = Math.max(1, this.retry.attempts);
    let last = "";
    let lastKind: SyncCallError["kind"] = "transport";
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let result;
      try {
        result = await this.client.graphql<T>(GQL[name], variables);
      } catch (error) {
        if (!(error instanceof AdminTransportError)) throw error;
        last = error.message;
        lastKind = "transport";
        const notExecuted = error.status === 429;
        if (!notExecuted && !idempotent) {
          if (!options.recover) {
            throw new SyncCallError(`${name}: ${error.message} (not retried: it may have been applied)`, "transport");
          }
          const recovered = await options.recover();
          if (recovered !== null) {
            this.logger.warn(`${name}: response lost (${error.message}); recovered the result by lookup`);
            return recovered;
          }
        }
        if (attempt === attempts) break;
        const wait = this.delay(attempt, error.retryAfterMs);
        this.logger.warn(`${name}: ${error.message}; retry ${attempt + 1}/${attempts} in ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (result.errors && result.errors.length > 0) {
        const message = result.errors.map((e) => e.message).join("; ");
        if (!isThrottled(result)) throw new SyncCallError(`${name}: ${message}`, "graphql");
        last = message;
        lastKind = "throttled";
        if (attempt === attempts) break;
        const wait = this.delay(attempt, null);
        this.logger.warn(`${name}: throttled; retry ${attempt + 1}/${attempts} in ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (result.data === undefined || result.data === null) throw new SyncCallError(`${name}: empty response`, "empty");
      return result.data;
    }
    throw new SyncCallError(`${name}: ${last} (gave up after ${attempts} attempts)`, lastKind);
  }

  /**
   * Poll an async Shopify job until `isDone` (first check immediately).
   * Returns the last response and whether it finished within pollAttempts.
   */
  async poll<T>(check: () => Promise<T>, isDone: (value: T) => boolean): Promise<{ value: T; done: boolean }> {
    let value = await check();
    for (let i = 1; i < this.retry.pollAttempts && !isDone(value); i += 1) {
      await this.sleep(this.retry.pollDelayMs);
      value = await check();
    }
    return { value, done: isDone(value) };
  }
}

/** metafieldsSet (≤ 25 inputs; the caller batches). Returns null on success, else a readable error. */
export async function setMetafields(transport: Transport, metafields: Record<string, unknown>[]): Promise<string | null> {
  try {
    const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsSet", { metafields });
    return userErrorText(data.metafieldsSet.userErrors);
  } catch (error) {
    return errorText(error);
  }
}
