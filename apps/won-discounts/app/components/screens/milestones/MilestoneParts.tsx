// Milníky, the parts of the screen (milestones/MilestonesScreen.tsx): the list of a step's gifts, the looks per
// place on the web and the shared constants of the page.

import { useEffect, useState } from "react";
import type { MilestoneKind } from "@won/core/discounts/milestones";
import type { MessageKey } from "../../../i18n";
import { useT } from "../../../i18n/context";
import { LookSection } from "../../looks/LookSection";
import { presetLabel } from "../../model/looks";
import { MS_FIELD } from "../../model/milestones";
import type { EmbedState, EmbedView, GiftVariantView, LookView, MilestoneStepView, RewardsScreenData, UiResult } from "../../model/types";
import { hoverMark } from "../../shell/hover";
import { type PickIcon } from "../../shell/PickList";
import { WON_CONTROL_EDGE, WON_FONT, WON_INK, WON_MUTED, WON_SELECT, WON_SELECT_RING, WON_SELECT_TINT, WON_SURFACE } from "../../shell/tokens";
import { WonRow } from "../../shell/WonSection";

export const F = MS_FIELD;

export interface MilestonesScreenProps extends RewardsScreenData {
  result?: UiResult | null;
  /** "shipping": opened from the setup guide — a shop without a step starts with free shipping, its amounts prefilled (audit N1). */
  start?: "shipping" | null;
}

export interface Row {
  /** The form key: the stored step's id, or "new-…". */
  uid: string;
  initial: MilestoneStepView;
  choices: GiftVariantView[];
  fallback: GiftVariantView | null;
  /** Stored already (a fact about the shop: its missing amounts are said at once). */
  stored: boolean;
}

/** The app embed's state → its sentence, what to do about it, and the one action (the cart drawer needs Won switched on in the store). */
export const EMBED_COPY: Readonly<Record<Exclude<EmbedState, "on">, { summary: MessageKey; fix: MessageKey; action: MessageKey; primary: boolean }>> = {
  off: { summary: "rewards.cart.off", fix: "rewards.cart.embedNeeded", action: "rewards.cart.activate", primary: true },
  draft_only: { summary: "rewards.cart.draftOnly", fix: "rewards.cart.draftOnlyFix", action: "rewards.cart.activate", primary: true },
  unknown: { summary: "rewards.cart.unknown", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
  no_scope: { summary: "rewards.cart.noScope", fix: "rewards.cart.checkFix", action: "rewards.cart.check", primary: false },
};

/** The DOM id of the card of the step at a position (the row of numbers jumps to it; positions follow the live list). */
export const stepAnchor = (index: number) => `step-${index + 1}`;

/** The two questions of a step's form ("1. Co zákazník dostane", "2. Od jaké hodnoty košíku"). */
export const STEP_HEADING = { fontFamily: WON_FONT, fontSize: 13.5, fontWeight: 700, color: WON_INK } as const;

/** The steps as a table; on a phone the amount and the state share the line under the reward. */
export const TABLE_CSS = `
.won-ms-row{box-sizing:border-box;display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr) 170px 150px;gap:4px 14px;align-items:center;padding:11px 16px}
@media (max-width:640px){.won-ms-row{grid-template-columns:minmax(0,1fr) auto}.won-ms-row__market,.won-ms-head{display:none}.won-ms-row__reward{grid-column:1/-1;grid-row:1}}
`;

/** A row of the settings: the frame around them carries no padding of its own. */
export const SETTING = { paddingInline: 16 } as const;

/** The new step by its reward: the same three a step's form offers. */
export const NEW_STEPS: readonly { kind: MilestoneKind; icon: PickIcon; title: MessageKey; body: MessageKey }[] = [
  { kind: "shipping", icon: "truck", title: "milestones.kind.shipping", body: "milestones.new.shipping" },
  { kind: "gift", icon: "gift", title: "milestones.kind.gift", body: "milestones.new.gift" },
  { kind: "discount", icon: "percent", title: "milestones.new.discountTitle", body: "milestones.new.discount" },
];

export function errorText(result: UiResult | null | undefined, field: string, t: ReturnType<typeof useT>["t"]): string | undefined {
  if (!result || result.ok || result.reason !== "invalid") return undefined;
  const e = result.errors?.find((x) => x.field === field);
  return e ? t(e.key, e.params) : undefined;
}

export const majorOf = (raw: string | undefined): number => Number((raw ?? "").trim().replace(/\s/g, "").replace(",", "."));

export function GiftList({ items, onRemove, removeLabel, unknown }: { items: readonly GiftVariantView[]; onRemove: (id: string) => void; removeLabel: string; unknown: string }) {
  return (
    <s-stack direction="block" gap="small-200">
      {items.map((g) => (
        <WonRow
          key={g.id}
          action={
            <s-button variant="tertiary" onClick={() => onRemove(g.id)}>
              {removeLabel}
            </s-button>
          }
        >
          <s-text>{g.title || unknown}</s-text>
        </WonRow>
      ))}
    </s-stack>
  );
}

/**
 * The ladder's look, one place at a time (7th round, bod 3: a strip at the top cannot look like the ladder of the
 * cart page): the places as a row of buttons, under it the chosen place's look — its own form with its own Save.
 * The others stay mounted and out of sight, so what was picked or typed in one is not lost by looking at another.
 * A deep link `#look-<place>` opens that place.
 */
export function PlaceLooks({ looks, plan, configVersion, embed }: { looks: readonly LookView[]; plan: "free" | "pro"; configVersion: string | null; embed?: EmbedView | null }) {
  const tr = useT();
  const { t } = tr;
  const [place, setPlace] = useState(looks[0]?.element ?? "milestones");
  useEffect(() => {
    const wanted = window.location.hash.replace(/^#look-/, "");
    if (looks.some((look) => look.element === wanted)) setPlace(wanted as LookView["element"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the address is read once, when the panel mounts
  }, []);
  if (looks.length === 1) return <LookSection look={looks[0]!} plan={plan} configVersion={configVersion} embed={embed} />;
  return (
    <s-stack direction="block" gap="base">
      <div data-won-look-places="" style={{ fontFamily: WON_FONT }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("milestones.look.places")}</div>
        <div style={{ marginTop: 2, marginBottom: 10, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{t("milestones.look.intro")}</div>
        <div role="group" aria-label={t("milestones.look.places")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {looks.map((look) => {
            const on = look.element === place;
            return (
              <button
                key={look.element}
                type="button"
                data-won-look-place={look.element}
                aria-pressed={on}
                onClick={() => setPlace(look.element)}
                {...hoverMark("chip", on)}
                style={{ display: "grid", gap: 1, padding: on ? "7px 13px" : "8px 14px", borderRadius: 10, textAlign: "left", cursor: "pointer", font: "inherit", border: `${on ? 2 : 1}px solid ${on ? WON_SELECT : WON_CONTROL_EDGE}`, background: on ? WON_SELECT_TINT : WON_SURFACE, boxShadow: on ? `0 0 0 3px ${WON_SELECT_RING}` : "none" }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{t(`milestones.look.place.${look.element}` as "milestones.look.place.msBar")}</span>
                <span style={{ fontSize: 12, color: WON_MUTED }}>{look.presets.length > 1 ? presetLabel(look.element, look.preset, tr) : t(Object.values(look.custom).some((v) => v.trim() !== "") ? "looks.custom.summary.on" : "looks.custom.summary.off")}</span>
              </button>
            );
          })}
        </div>
      </div>
      {looks.map((look) => (
        <div key={look.element} data-won-look-panel={look.element} style={{ display: look.element === place ? "block" : "none" }}>
          <LookSection look={look} plan={plan} configVersion={configVersion} embed={look.element === "cart" ? undefined : embed} />
        </div>
      ))}
    </s-stack>
  );
}
