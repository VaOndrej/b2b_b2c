// The raw HTML controls the admin keeps, each because Polaris has no equivalent (audit 2026-11-03 D2, decided by
// Ondřej: such exceptions live in shell/, everything else on a screen is an `s-*` component). Thin pass-throughs: a
// screen gives them their props and its look, the element itself is born only here.
//   - RangeInput: a slider (the Milníky preview walks the cart value; Polaris has no range field).
//   - RowButton: a list row that opens its own form (Milníky steps); Polaris has no expandable row.
//   - CardRadio / CardCheckbox: the input inside a choice card (Výprodej "s čím se sčítá"); Polaris choices cannot
//     carry a card around them.
//   - SampleButton: a button inside a sample of the storefront (the quantity stepper of the tier table's preview),
//     which shows the theme's look, not the admin's.
// The tiles (ModuleTile, ViewTile), the segmented choice (SegmentedChoice) and the discounts table (RuleTable) are the
// other exceptions, in their own files.

import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export function RangeInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="range" {...props} />;
}

export function RowButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button type="button" {...props} />;
}

export function CardRadio(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="radio" {...props} />;
}

export function CardCheckbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input type="checkbox" {...props} />;
}

export function SampleButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button type="button" {...props} />;
}
