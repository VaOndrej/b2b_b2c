// B14: after a refused save nothing typed may be lost. The action returns what the form posted (submittedOf), the
// screen seeds its fields from it (seedOf) and remounts them once per result (resultKey), so a Polaris field never
// has its attributes changed while it holds typed text. Errors are rendered beside the fields, never through `error`.
// Display only: the server parses the form itself and never trusts these values back (SEC-1).

import { useRef } from "react";

import type { FormDataLike } from "./rule-form";
import type { SubmittedValues } from "./types";

const MAX_VALUES = 50;
const MAX_LENGTH = 200;

/** The posted values of `names` (text only, capped), for the re-render of a refused form. */
export function submittedOf(form: FormDataLike, names: Iterable<string>): SubmittedValues {
  const out: SubmittedValues = {};
  for (const name of names) {
    const values = form
      .getAll(name)
      .filter((v): v is string => typeof v === "string")
      .slice(0, MAX_VALUES)
      .map((v) => v.slice(0, MAX_LENGTH));
    if (values.length > 0) out[name] = values;
  }
  return out;
}

export interface Seed {
  /** A refused form's values are here (false = the fields show what is stored). */
  active: boolean;
  /** The field's posted value, else `stored`. A field the form did not post (an unticked box) is "". */
  one(name: string, stored: string): string;
  all(name: string, stored: readonly string[]): string[];
}

export function seedOf(values: SubmittedValues | null | undefined): Seed {
  if (!values) return { active: false, one: (_name, stored) => stored, all: (_name, stored) => [...stored] };
  return { active: true, one: (name) => values[name]?.[0] ?? "", all: (name) => values[name] ?? [] };
}

/** Posted values read like the form they came from (the same pure readers work on both). */
export function asForm(values: SubmittedValues): FormDataLike {
  return { get: (name) => values[name]?.[0] ?? null, getAll: (name) => values[name] ?? [] };
}

/** The posted values of a refused result (null for anything else). */
export function refusedValues(result: unknown): SubmittedValues | null {
  const r = result as { ok?: unknown; values?: unknown } | null | undefined;
  return r && r.ok === false && r.values && typeof r.values === "object" ? (r.values as SubmittedValues) : null;
}

/** A refused result with what the form posted (read back by refusedValues); an accepted one unchanged. */
export function withValues<T extends { ok: boolean }>(result: T, values: () => SubmittedValues): T {
  return result.ok ? result : ({ ...result, values: values() } as T);
}

const keys = new WeakMap<object, number>();
let lastKey = 0;

/** A number per action result (0 = none): the form's fields remount once when a new result arrives. */
export function resultKey(result: object | null | undefined): number {
  if (!result) return 0;
  let key = keys.get(result);
  if (key === undefined) {
    lastKey += 1;
    key = lastKey;
    keys.set(result, key);
  }
  return key;
}

/**
 * The seed of a screen's form: the values of the LAST refused result this mount saw, and the key its fields remount
 * on. It stays on those values when another form's result arrives (the fields still hold them), until `clear()`.
 */
export function useRefusedSeed(result: object | null | undefined): { seed: Seed; values: SubmittedValues | null; key: number; clear: () => void } {
  const last = useRef<{ values: SubmittedValues | null; key: number }>({ values: null, key: 0 });
  const values = refusedValues(result);
  if (values && result && last.current.key !== resultKey(result)) last.current = { values, key: resultKey(result) };
  return {
    seed: seedOf(last.current.values),
    values: last.current.values,
    key: last.current.key,
    clear: () => {
      last.current = { values: null, key: last.current.key };
    },
  };
}
