// Umístění na webu (14 Oct 2026): the tags a merchant (or their AI) puts into the theme's own code where an app block
// cannot go — one element for everything, `<won-discounts show="…">`, which the embed fills (blocks/
// won_discounts_embed.liquid + assets/won-discounts-tags.js). The block stays the default way in; a tag is the
// optional one. This list is written once: the support reference (scripts/gen-docs.ts), the admin's guide and the
// brief for an AI read it.

export const THEME_TAG = "won-discounts";

export interface ThemeTagAttr {
  name: string;
  /** The values it takes; absent = free text (described in `about`). */
  values?: readonly string[];
  /** The value used when the attribute is missing or not one of `values`. */
  fallback?: string;
  about: string;
}

export interface ThemeTag {
  show: "cart" | "card-tier" | "milestones" | "campaign";
  /** The app blocks (blocks/<handle>.liquid) the tag stands in for. */
  blocks: readonly string[];
  /** Where it shows something. */
  where: string;
  attrs: readonly ThemeTagAttr[];
  /** One line to paste, Liquid included where the tag needs the product. */
  example: string;
}

export const THEME_TAGS: readonly ThemeTag[] = [
  {
    show: "cart",
    blocks: ["cart_rewards"],
    where: "The cart drawer or the cart page: the Milestones ladder, the gift and the discount code field.",
    attrs: [{ name: "size", values: ["compact", "full"], fallback: "compact", about: "`compact` (a drawer) or `full` (every step, for the cart page)." }],
    example: `<${THEME_TAG} show="cart"></${THEME_TAG}>`,
  },
  {
    show: "card-tier",
    blocks: ["card_tiers"],
    where: "A product card on any page (collections, search, the home page, recommendations): the first quantity break, e.g. “From 3 items −10%”.",
    attrs: [{ name: "product", about: "The card's product handle, from the card's own Liquid: `{{ product.handle }}` (Dawn's card snippet: `{{ card_product.handle }}`)." }],
    example: `<${THEME_TAG} show="card-tier" product="{{ product.handle }}"></${THEME_TAG}>`,
  },
  {
    show: "milestones",
    blocks: ["rewards_progress", "announcement_milestones"],
    where: "Anywhere: the ladder of steps by cart value (free shipping, gifts, order discounts).",
    attrs: [
      { name: "size", values: ["bar", "compact", "full"], fallback: "compact", about: "`bar` (one sentence and a thin track), `compact` (a mark per step) or `full` (every step with its reward)." },
      { name: "align", values: ["start", "center"], fallback: "start", about: "`start` or `center`." },
    ],
    example: `<${THEME_TAG} show="milestones" size="bar"></${THEME_TAG}>`,
  },
  {
    show: "campaign",
    blocks: ["campaign_banner", "announcement_campaign"],
    where: "Anywhere: the name of the campaign running now and the time left.",
    attrs: [
      { name: "text", fallback: "{name}", about: "The line, with `{name}` for the campaign's name." },
      { name: "align", values: ["start", "center"], fallback: "start", about: "`start` or `center`." },
    ],
    example: `<${THEME_TAG} show="campaign"></${THEME_TAG}>`,
  },
];
