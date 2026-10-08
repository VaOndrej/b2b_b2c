// How a jump inside a page moves: smoothly, unless the system asks for less motion. One answer for the list
// "Na této stránce" (SectionNav), the row of numbers (JumpRow) and the rule editor's deep links.

export function jumpBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
