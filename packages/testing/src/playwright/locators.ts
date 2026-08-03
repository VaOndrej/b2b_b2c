import type { Locator } from "@playwright/test";

/**
 * Theme-agnostic DOM-relationship helpers for storefront tests.
 *
 * Themes wire the product form and its quantity controls together in different,
 * both-valid ways, so tests must not assume one shape:
 *
 * - Horizon nests the quantity input (and its stepper buttons) inside the
 *   `<form action="/cart/add">`.
 * - Dawn keeps the `<form>` elsewhere in the DOM and associates the input via
 *   the `form="<id>"` attribute; its stepper buttons live in a `<quantity-input>`
 *   OUTSIDE the form entirely.
 *
 * Resolve relationships through these helpers instead of `ancestor::form` so a
 * spec written once passes on every theme in the matrix.
 */

/**
 * The `/cart/add` form a quantity input submits to. Prefers the HTML form
 * association (`form` attribute → Dawn), falling back to the nearest ancestor
 * form (nesting → Horizon).
 */
export async function quantityForm(input: Locator): Promise<Locator> {
  const formId = await input.getAttribute("form");
  if (formId) {
    const associated = input.page().locator(`form[id="${formId}"]`);
    if ((await associated.count()) > 0) return associated;
  }
  return input.locator("xpath=ancestor::form[contains(@action, '/cart/add')][1]");
}

/**
 * The stepper wrapper holding the plus/minus buttons next to the input. These
 * are theme JS controls (not form fields) and on Dawn sit outside the form, so
 * scope button lookups to the input's own container — `<quantity-input>` (Dawn),
 * `<quantity-selector-component>` (Horizon), or a `.quantity` wrapper.
 */
export function quantityStepper(input: Locator): Locator {
  return input.locator(
    "xpath=ancestor::*[self::quantity-input or self::quantity-selector-component or contains(concat(' ', normalize-space(@class), ' '), ' quantity ')][1]",
  );
}
