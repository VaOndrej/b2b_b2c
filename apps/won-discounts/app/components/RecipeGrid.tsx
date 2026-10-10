// The four recipes (docs/won-discounts/rozhodnuti.md: "% na vše", "částka z
// objednávky", "doprava zdarma", "uvítací kód"). Each card opens the editor with
// the values pre-filled (§15b: one clear next step from an empty state).
// "Vlastní sleva" (feedback 3, bod 15; it was "Prázdná sleva") opens the same
// form with nothing pre-filled. It is a card like the recipes, with a sentence
// saying what it is, and a dashed edge: not a recipe.

import type { MessageKey } from "../i18n";
import { useT } from "../i18n/context";
import type { RecipeKey } from "./model/rule-form";
import { hoverMark } from "./shell/hover";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "./shell/tokens";

const RECIPES: readonly { key: Exclude<RecipeKey, "blank">; title: MessageKey; body: MessageKey }[] = [
  { key: "percentAll", title: "recipe.percentAll.title", body: "recipe.percentAll.body" },
  { key: "amountOff", title: "recipe.amountOff.title", body: "recipe.amountOff.body" },
  { key: "freeShipping", title: "recipe.freeShipping.title", body: "recipe.freeShipping.body" },
  { key: "welcomeCode", title: "recipe.welcomeCode.title", body: "recipe.welcomeCode.body" },
];

export function recipeHref(recipe: RecipeKey): string {
  return `/app/discounts/new?recipe=${recipe}`;
}

export function RecipeGrid({ withBlank = false }: { withBlank?: boolean }) {
  const { t } = useT();
  return (
    <div style={{ fontFamily: WON_FONT }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))",
          gap: 10,
        }}
      >
        {RECIPES.map((recipe) => (
          <s-clickable key={recipe.key} href={recipeHref(recipe.key)} borderRadius="base">
            <div
              {...hoverMark("card")}
              style={{
                border: `1px solid ${WON_LINE}`,
                borderRadius: 11,
                padding: "11px 12px",
                background: "#fff",
                minHeight: 62,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t(recipe.title)}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, marginTop: 3 }}>{t(recipe.body)}</div>
            </div>
          </s-clickable>
        ))}
      </div>
      {withBlank ? (
        <div style={{ marginTop: 10 }}>
          <s-clickable href={recipeHref("blank")} borderRadius="base">
            <div
              data-won-recipe="blank"
              {...hoverMark("card")}
              style={{
                border: `1px dashed #b7c0cb`,
                borderRadius: 11,
                padding: "11px 12px",
                background: WON_WASH,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t("recipe.blank.title")}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, marginTop: 3 }}>{t("recipe.blank.body")}</div>
            </div>
          </s-clickable>
        </div>
      ) : null}
    </div>
  );
}
