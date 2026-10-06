// Section 4 "Kdy platí": whole shop-local days, the end day inclusive. P3: a
// rule that does not run because of its dates says so at the date that decides
// (the start of a scheduled rule, the end of a finished one).

import { formatDate } from "@won/core/discounts/describe";

import { describeSchedule } from "../model/describe";
import { FIELD } from "../model/rule-form";
import type { RuleStatus } from "../model/rule-status";
import { boolAttr } from "../shell/attrs";
import { WonSection } from "../shell/WonSection";
import { FieldGrid, FieldMark, type EditorView } from "./parts";

export function ScheduleSection({ ed, status }: { ed: EditorView; status: RuleStatus }) {
  const { draft, defaults, errorFor, tr, timezone, readOnly } = ed;
  const { t } = tr;
  const off = boolAttr(readOnly);
  const date = status.date ? formatDate(status.date, tr.locale) : "";
  return (
    <WonSection title={t("editor.schedule.title")} glyph="calendar" summary={describeSchedule(draft, tr, timezone) || t("describe.schedule.always")} anchor="schedule">
      <s-stack direction="block" gap="small-200">
        <FieldGrid>
          <div>
            <s-date-field name={FIELD.startDate} label={t("editor.schedule.start")} value={defaults.startDate} error={errorFor(FIELD.startDate)} disabled={off} />
            {status.kind === "scheduled" ? <FieldMark tone="info" text={t("editor.mark.scheduled", { date })} /> : null}
          </div>
          <div>
            <s-date-field name={FIELD.endDate} label={t("editor.schedule.end")} value={defaults.endDate} error={errorFor(FIELD.endDate)} disabled={off} />
            {status.kind === "ended" ? <FieldMark text={t("editor.mark.ended", { date })} /> : null}
          </div>
        </FieldGrid>
        <s-text color="subdued">{timezone ? t("editor.schedule.details", { tz: timezone }) : t("editor.schedule.detailsUtc")}</s-text>
      </s-stack>
    </WonSection>
  );
}
