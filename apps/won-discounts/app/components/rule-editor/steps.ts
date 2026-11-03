// A new discount is filled in order: what the discount is, its conditions, how it applies, when, and what it adds up
// with. Its sections say so ("Krok 2 / 5", pravidla vzhledu P5). An existing discount is not walked through: its
// sections carry their names only, the side list "Na této stránce" moves around the page.
export const EDITOR_STEPS = 5;

/** The step label of section `n` (1-based): only on a new discount. */
export function editorStep(n: number, isNew: boolean): { n: number; of: number } | undefined {
  return isNew ? { n, of: EDITOR_STEPS } : undefined;
}
