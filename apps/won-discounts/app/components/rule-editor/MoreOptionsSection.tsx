// "Další možnosti" (§9: rare controls, collapsed, with a truthful summary):
// minimum per currency, minimum quantity and — for a product / collection rule
// — where the minimum is measured (the whole cart or only the rule's products;
// kept on edit, cart for new rules), schedule days, usage limits.

import { describeLimits, describeMinimum, describeMoreOptions, describeSchedule } from "../model/describe";
import { FIELD } from "../model/rule-form";
import { boolAttr } from "../shell/attrs";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { WonBlock, WonSection } from "../shell/WonSection";
import { FieldGrid, Shown, type EditorView } from "./parts";

export function MoreOptionsSection({ ed, defaultOpen }: { ed: EditorView; defaultOpen: boolean }) {
  const { draft, defaults, codes, errorFor, tr, timezone } = ed;
  const { t } = tr;
  const isCode = draft.method === "code";
  const targetsProducts = draft.target.kind === "products" || draft.target.kind === "collections";
  return (
    <WonSection
      title={t("editor.more.title")}
      glyph="sliders"
      summary={describeMoreOptions(draft, tr, codes, timezone)}
      collapsible
      defaultOpen={defaultOpen}
      anchor="more"
    >
      <s-stack direction="block" gap="base">
        <WonBlock title={t("editor.minimum.title")} summary={describeMinimum(draft, tr, codes) || t("describe.minimum.none")}>
          <s-stack direction="block" gap="small-200">
            {codes.length > 1 ? <s-text color="subdued">{t("editor.minimum.details")}</s-text> : null}
            <FieldGrid>
              {codes.map((c) => (
                <s-number-field
                  key={c}
                  name={FIELD.minimum(c)}
                  label={t("editor.minimum.label", { currency: c })}
                  value={defaults.minimums[c] ?? ""}
                  min={0}
                  suffix={c}
                  inputMode="decimal"
                  error={errorFor(FIELD.minimum(c))}
                />
              ))}
              <s-number-field
                name={FIELD.minQty}
                label={t("editor.minQty.label")}
                value={defaults.minQty}
                min={0}
                inputMode="numeric"
                error={errorFor(FIELD.minQty)}
              />
            </FieldGrid>
            <Shown when={targetsProducts}>
              <SegmentedChoice
                name={FIELD.minScope}
                label={t("editor.minimum.scope")}
                defaultValue={defaults.minScope}
                options={[
                  { value: "cart", label: t("editor.minimum.scope.cart") },
                  { value: "entitled", label: t("editor.minimum.scope.entitled") },
                ]}
              />
            </Shown>
          </s-stack>
        </WonBlock>
        <WonBlock title={t("editor.schedule.title")} summary={describeSchedule(draft, tr, timezone) || t("describe.schedule.always")}>
          <s-stack direction="block" gap="small-200">
            <FieldGrid>
              <s-date-field name={FIELD.startDate} label={t("editor.schedule.start")} value={defaults.startDate} error={errorFor(FIELD.startDate)} />
              <s-date-field name={FIELD.endDate} label={t("editor.schedule.end")} value={defaults.endDate} error={errorFor(FIELD.endDate)} />
            </FieldGrid>
            <s-text color="subdued">{timezone ? t("editor.schedule.details", { tz: timezone }) : t("editor.schedule.detailsUtc")}</s-text>
          </s-stack>
        </WonBlock>
        <WonBlock title={t("editor.limits.title")} summary={isCode ? describeLimits(draft, tr) || t("describe.limits.none") : t("editor.limits.codeOnly")}>
          <Shown when={isCode}>
            <s-stack direction="block" gap="small-200">
              <s-number-field
                name={FIELD.usageLimit}
                label={t("editor.limits.usage")}
                value={defaults.usageLimit}
                min={1}
                inputMode="numeric"
                details={t("editor.limits.usageDetails")}
                error={errorFor(FIELD.usageLimit)}
              />
              <s-checkbox name={FIELD.oncePerCustomer} value="on" label={t("editor.limits.once")} checked={boolAttr(defaults.oncePerCustomer)} />
            </s-stack>
          </Shown>
        </WonBlock>
      </s-stack>
    </WonSection>
  );
}
