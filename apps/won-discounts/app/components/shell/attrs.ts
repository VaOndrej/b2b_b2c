/**
 * Boolean attribute for a Polaris web component (`checked`, `disabled`,
 * `selected`). React 18 writes `false` onto a custom element as the string
 * "false", which the element reads as present = true; so `false` is omitted.
 */
export function boolAttr(value: boolean): true | undefined {
  return value ? true : undefined;
}
