// The four recipes (docs/won-discounts/rozhodnuti.md: "% na vše", "částka z
// objednávky", "doprava zdarma", "uvítací kód"). Each card opens the editor with
// the values pre-filled (§15b: one clear next step from an empty state).
// "Vlastní sleva" (feedback 3, bod 15; it was "Prázdná sleva") opens the same
// form with nothing pre-filled: the last row of RecipePicker, the list on "Slevy a kódy".

import type { MessageKey } from "../i18n";
import { useT } from "../i18n/context";
import type { RecipeKey } from "./model/rule-form";
import { hoverMark } from "./shell/hover";
import { PickList, type PickIcon } from "./shell/PickList";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED } from "./shell/tokens";

const RECIPES: readonly { key: Exclude<RecipeKey, "blank">; icon: PickIcon; title: MessageKey; body: MessageKey }[] = [
  { key: "percentAll", icon: "percent", title: "recipe.percentAll.title", body: "recipe.percentAll.body" },
  { key: "amountOff", icon: "coin", title: "recipe.amountOff.title", body: "recipe.amountOff.body" },
  { key: "freeShipping", icon: "truck", title: "recipe.freeShipping.title", body: "recipe.freeShipping.body" },
  { key: "welcomeCode", icon: "ticket", title: "recipe.welcomeCode.title", body: "recipe.welcomeCode.body" },
];

export function recipeHref(recipe: RecipeKey): string {
  return `/app/discounts/new?recipe=${recipe}`;
}

export function RecipePicker() {
  const { t } = useT();
  return (
    <PickList
      items={[
        ...RECIPES.map((recipe) => ({ key: recipe.key, icon: recipe.icon, title: t(recipe.title), body: t(recipe.body), href: recipeHref(recipe.key) })),
        { key: "blank", icon: "pen" as const, title: t("recipe.blank.title"), body: t("recipe.blank.body"), href: recipeHref("blank"), marker: { "data-won-recipe": "blank" } },
      ]}
    />
  );
}

export function RecipeGrid() {
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
    </div>
  );
}
