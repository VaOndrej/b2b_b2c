// The ready-made highlight colour of a storefront element, on every plan (core ACCENT_PRESETS): native radios, so
// the pick is a field of the form around it. "Podle webu" is the theme's own colour; any other is written by Won
// on the storefront — with Won there switched off, the picker says so and links to switching it on.

import { useId } from "react";

import { ACCENT_PRESETS } from "@won/core/discounts/config";
import { ACCENT_COLORS } from "@won/core/discounts/custom-look";

import { useT } from "../../i18n/context";
import type { EmbedView } from "../model/types";
import { selectionRing, WON_ATTENTION, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";

export function AccentPicker({ name, value, stored, onPick, embed }: { name: string; value: string; stored: string; onPick: (accent: string) => void; embed?: EmbedView | null }) {
  const { t } = useT();
  const labelId = useId();
  const needsEmbed = value !== "theme" && (embed?.state === "off" || embed?.state === "draft_only");
  return (
    <div style={{ display: "grid", gap: 5, marginTop: 4 }}>
      <div id={labelId} style={{ fontSize: 13, fontWeight: 500, color: WON_INK }}>
        {t("tiers.preview.accent")}
      </div>
      <div role="radiogroup" aria-labelledby={labelId} data-won-accent-picker style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ACCENT_PRESETS.map((a) => (
          <label
            key={a}
            style={{
              ...selectionRing(value === a),
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              padding: "4px 10px 4px 6px",
              fontSize: 12.5,
              fontWeight: value === a ? 700 : 500,
              color: WON_INK,
              cursor: "pointer",
              fontFamily: WON_FONT,
            }}
          >
            <input type="radio" name={name} value={a} checked={value === a} onChange={() => onPick(a)} style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }} />
            <span
              aria-hidden="true"
              style={{ width: 14, height: 14, borderRadius: 999, flex: "0 0 auto", background: ACCENT_COLORS[a] ?? "conic-gradient(#111418 0 50%, #c9d0d8 0 100%)", border: "1px solid rgba(17,20,24,.18)" }}
            />
            {t(`tiers.preview.accent.${a}` as "tiers.preview.accent.theme")}
          </label>
        ))}
      </div>
      {needsEmbed ? (
        <div data-won-accent-embed-off style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_ATTENTION }}>
          {t("tiers.preview.accentEmbedOff")}{" "}
          {embed?.activateUrl ? (
            <s-link href={embed.activateUrl} target="_top">
              {t("tiers.preview.accentEmbedOn")}
            </s-link>
          ) : null}
        </div>
      ) : value !== stored ? (
        <div style={{ fontSize: 12, color: WON_MUTED }}>{t("tiers.preview.accentNote")}</div>
      ) : null}
    </div>
  );
}
