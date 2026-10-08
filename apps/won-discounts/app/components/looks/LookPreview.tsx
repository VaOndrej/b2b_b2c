// A storefront element as the customer sees it, for picking its look: the extension's own markup and CSS (the
// same files the storefront loads) with a sample content, and over them the look as the storefront would get it
// (core looks.ts: the ready-made look, the colour, the Pro custom look) — each preview confined to its own scope,
// so several looks of one element can stand side by side.

import { useId } from "react";

import baseCss from "../../../extensions/won-discounts-storefront/assets/won-discounts.css?raw";
import outletCss from "../../../extensions/won-discounts-storefront/assets/won-discounts-outlet.css?raw";
import type { LooksElement } from "@won/core/discounts/looks";

import { useT } from "../../i18n/context";
import { WON_LINE } from "../shell/tokens";
import { scopeCss } from "../tiers/scope-css";

/** The scope the extension's CSS is nested under in the admin. */
export const LOOK_PREVIEW_SCOPE = "won-look-preview";

const SCOPED_CSS = scopeCss(`${baseCss}\n${outletCss}`, `.${LOOK_PREVIEW_SCOPE}`);

/** The extension's CSS, once for a page with several previews. */
export function LookPreviewStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />;
}

const FRAME = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontSize: 15, lineHeight: 1.5, color: "#121212", background: "#ffffff", padding: 14, borderRadius: 10, border: `1px solid ${WON_LINE}`, textAlign: "start" } as const;

export function LookPreview({ element, css }: { element: LooksElement; css: string }) {
  const { t } = useT();
  // A class of its own for this preview's look (useId gives ":r1:" — only letters and digits make a class).
  const scope = `won-look-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className={`${LOOK_PREVIEW_SCOPE} ${scope}`} data-won-look-preview={element} style={FRAME}>
      {css ? <style data-won-look-css="" dangerouslySetInnerHTML={{ __html: scopeCss(css, `.${scope}`) }} /> : null}
      {element === "milestones" ? (
        <div className="won-ms won-ms--compact">
          <p className="won-ms__text">{t("looks.sample.ms.text")}</p>
          <div className="won-ms__track" role="presentation">
            <span style={{ width: "55%" }} />
            <i style={{ left: "38%" }} data-done="" data-new="" />
            <i style={{ left: "63%" }} />
            <i style={{ left: "100%" }} />
          </div>
          <ol className="won-ms__list">
            <li data-done="" data-new="">
              <span>{t("looks.sample.ms.ship")}</span>
              <span>{t("looks.sample.ms.from1")}</span>
            </li>
            <li>
              <span>{t("looks.sample.ms.gift")}</span>
              <span>{t("looks.sample.ms.from2")}</span>
            </li>
            <li>
              <span>{t("looks.sample.ms.disc")}</span>
              <span>{t("looks.sample.ms.from3")}</span>
            </li>
          </ol>
        </div>
      ) : element === "outlet" ? (
        <div className="won-outlet">
          <p className="won-outlet__row">
            <span className="won-outlet__badge">{t("looks.sample.outlet.badge")}</span>
            <span className="won-outlet__left">{t("looks.sample.outlet.left")}</span>
            <span className="won-outlet__time">
              <span className="won-campaign__time">{t("looks.sample.time")}</span>
            </span>
          </p>
        </div>
      ) : (
        <div className="won-campaign won-campaign--center">
          <p className="won-campaign__title">{t("looks.sample.campaign.title")}</p>
          <p className="won-campaign__time">{t("looks.sample.time")}</p>
        </div>
      )}
    </div>
  );
}
