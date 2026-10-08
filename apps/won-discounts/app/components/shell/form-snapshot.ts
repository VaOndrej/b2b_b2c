// What a form holds right now, read natively (an `s-*` field has no React onChange): the pages' live state lines
// and previews follow it on every `input` / `change`.

/** The last read value of every field (the first one of a name). */
export function snapshotOf(form: HTMLFormElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of new FormData(form).entries()) if (!out.has(name) && typeof value === "string") out.set(name, value);
  return out;
}
