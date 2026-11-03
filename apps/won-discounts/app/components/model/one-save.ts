// One save per page (audit 2026-11-03 F3, doctrine §18i): the page has ONE form with the App Bridge save bar. A part of
// the page that is stored by its own action (Sčítá se s → /app/combine) lives in that form with its field names
// prefixed (`part:<key>:<name>`); on Save the form is split here into the page's own fields and each part's, and every
// action gets exactly the fields it got from its own form before (the backend contracts do not change).

export const PART_PREFIX = "part:";

/** The name a part's field carries in the page's form. */
export function partField(part: string, name: string): string {
  return `${PART_PREFIX}${part}:${name}`;
}

export type FormEntry = [string, string];

export interface SplitSave {
  /** The page's own fields, in form order. */
  page: FormEntry[];
  /** Each part's fields, names without the prefix, in form order. */
  parts: Map<string, FormEntry[]>;
}

/** Splits a form's entries (files are not part of any of these forms and are dropped). */
export function splitSave(entries: Iterable<[string, FormDataEntryValue | string]>): SplitSave {
  const page: FormEntry[] = [];
  const parts = new Map<string, FormEntry[]>();
  for (const [name, value] of entries) {
    if (typeof value !== "string") continue;
    if (!name.startsWith(PART_PREFIX)) {
      page.push([name, value]);
      continue;
    }
    const rest = name.slice(PART_PREFIX.length);
    const at = rest.indexOf(":");
    if (at <= 0) {
      page.push([name, value]);
      continue;
    }
    const key = rest.slice(0, at);
    const list = parts.get(key) ?? [];
    list.push([rest.slice(at + 1), value]);
    parts.set(key, list);
  }
  return { page, parts };
}

/** Same fields with the same values, whatever the order (a part or the page did not change). */
export function sameEntries(a: readonly FormEntry[], b: readonly FormEntry[]): boolean {
  const key = (list: readonly FormEntry[]) =>
    list
      .map(([name, value]) => `${name}\u0000${value}`)
      .sort()
      .join("\u0001");
  return key(a) === key(b);
}

export interface SavePlan {
  /** Post the page's own fields to the page's action. */
  page: boolean;
  /** The parts to post after it, in the order given. */
  parts: string[];
}

/**
 * What a Save posts: what changed against the form as it was loaded. Without that baseline (not read yet) everything
 * is posted — the page as it always was, a part only when it is in the form. Nothing changed: the page alone (the save
 * bar was used, so the merchant expects a save).
 */
export function planSave(now: SplitSave, baseline: SplitSave | null, order: readonly string[]): SavePlan {
  const present = order.filter((key) => now.parts.has(key));
  if (!baseline) return { page: true, parts: present };
  const parts = present.filter((key) => !sameEntries(now.parts.get(key) ?? [], baseline.parts.get(key) ?? []));
  const page = !sameEntries(now.page, baseline.page) || parts.length === 0;
  return { page, parts };
}
