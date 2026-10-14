// Umístění na webu (balík E3): the brief a merchant gives their own AI, and the "Udělám to sám" line. Written from
// the ONE description of the tags (theme-tags.ts), with the file the app read from the theme — the merchant looks
// nothing up. The app never calls an AI and never writes the theme (zadání, rozhodnuto 6): the merchant pastes the
// result and saves it. In English on purpose: it is read by an AI, and the theme's code is English too.

import { THEME_TAG, THEME_TAGS, type ThemeTag } from "./theme-tags";
import type { KnownShow, WebPlace } from "./theme-scan";

/** Where in the file, in words an AI finds in any theme. */
const WHERE: Record<WebPlace, string> = {
  drawer: "in the cart drawer, right above the checkout button (below the subtotal), so it is seen before checkout",
  cart: "on the cart page, right above the checkout button (below the subtotal)",
  card: "in the product card, right below the price",
  product: "in the product information, right below the price and above the add-to-cart button",
  header: "at the top of the page, inside the announcement bar or right below the header",
  home: "near the top of the home page, below the first section",
};

export function tagDef(show: KnownShow): ThemeTag {
  return THEME_TAGS.find((tag) => tag.show === show)!;
}

/** The one line to paste for this place: the tag's own example, the card with the card's own product variable. */
export function tagLine(show: KnownShow, place: WebPlace, file: string | null): string {
  if (show === "card-tier") {
    // Dawn's card snippet calls the product `card_product`; most others `product`.
    const variable = file === "snippets/card-product.liquid" ? "card_product" : "product";
    return `<${THEME_TAG} show="card-tier" product="{{ ${variable}.handle }}"></${THEME_TAG}>`;
  }
  if (show === "cart") return place === "cart" ? `<${THEME_TAG} show="cart" size="full"></${THEME_TAG}>` : `<${THEME_TAG} show="cart"></${THEME_TAG}>`;
  if (show === "milestones") return place === "header" ? `<${THEME_TAG} show="milestones" size="bar" align="center"></${THEME_TAG}>` : `<${THEME_TAG} show="milestones" size="compact"></${THEME_TAG}>`;
  if (show === "tiers" || show === "outlet") return `<${THEME_TAG} show="${show}"></${THEME_TAG}>`;
  return place === "header" ? `<${THEME_TAG} show="campaign" align="center"></${THEME_TAG}>` : `<${THEME_TAG} show="campaign"></${THEME_TAG}>`;
}

function attrsText(tag: ThemeTag): string {
  if (tag.attrs.length === 0) return "- (no attributes)";
  return tag.attrs.map((attr) => `- \`${attr.name}\`${attr.values ? ` (${attr.values.map((v) => `\`${v}\``).join(", ")})` : ""}: ${attr.about}`).join("\n");
}

/** The longest file content the brief carries (a Liquid file is at most 256 KB; a brief must still fit a chat box). */
export const BRIEF_MAX_CONTENT = 120_000;

export interface BriefInput {
  show: KnownShow;
  place: WebPlace;
  themeName: string;
  /** The file to change, as the theme names it; null = the app does not know which (the AI asks). */
  file: string | null;
  /** The file's current content as the app read it; null = not read. */
  content: string | null;
}

export function composeBrief(input: BriefInput): string {
  const tag = tagDef(input.show);
  const line = tagLine(input.show, input.place, input.file);
  const out: string[] = [];
  out.push(`I use the Shopify app Won Discounts. Please add one HTML element to my Shopify theme "${input.themeName}".`);
  out.push("");
  out.push("## What to add");
  out.push("```liquid", line, "```");
  out.push("");
  out.push("## Where");
  out.push(input.file ? `In the file \`${input.file}\`, ${WHERE[input.place]}.` : `${WHERE[input.place].replace(/^./, (c) => c.toUpperCase())}. I do not know which file draws it: tell me which file of my theme to open and I will paste it to you.`);
  out.push("");
  out.push("## Rules");
  out.push(`- Add only this one element. Do not change, remove, reorder or reformat anything else in the file.`);
  out.push(`- Do not add Liquid logic, scripts, styles or a wrapper around it. The app fills the element by itself; an empty element takes no space.`);
  out.push(`- Keep \`show="${tag.show}"\` exactly. Other attributes:`);
  out.push(attrsText(tag));
  out.push(`- If the file draws this place more than once (e.g. a desktop and a mobile version), put it in the one that is shown in both, or tell me.`);
  const whole = input.file !== null && input.content !== null && input.content.length <= BRIEF_MAX_CONTENT;
  out.push(whole ? "- Answer with the WHOLE changed file, ready to paste over the current one, and then one sentence saying where you put it." : "- Answer with the exact lines around the place where it goes, and the element in between.");
  out.push("");
  out.push(`What it shows: ${tag.where}`);
  if (input.file && input.content !== null) {
    const cut = input.content.length > BRIEF_MAX_CONTENT;
    out.push("");
    out.push(`## The current file \`${input.file}\`${cut ? ` (the first ${BRIEF_MAX_CONTENT} characters; it is longer)` : ""}`);
    out.push("```liquid", cut ? input.content.slice(0, BRIEF_MAX_CONTENT) : input.content, "```");
  }
  return out.join("\n");
}
