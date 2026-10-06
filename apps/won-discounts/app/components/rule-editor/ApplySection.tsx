// Section 3 "Jak se uplatní": automatically or with codes, and — for a code
// rule only (Shopify counts uses of codes, nothing else) — the usage limits.
// An automatic rule shows no limits at all (P2). P3: a code rule without a code
// is marked at the codes field from the live draft. P5: the cap on active code
// rules counts the draft as it is now and is said only when it is close.
//
// The codes are one block (`codes`), the limits another: the code generator and
// the code list (a later wave) replace the text area inside the first.

import { ruleHasCodes, type CodeBatchSpec } from "@won/core/discounts/code-batch";

import { describeLimits, describeMethod } from "../model/describe";
import { FIELD } from "../model/rule-form";
import type { CodeRuleLimit, GeneratedBatchView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { WonSection } from "../shell/WonSection";
import { CodeGenerator, GeneratedBatches } from "./GeneratedCodes";
import { FieldMark, Shown, type EditorView } from "./parts";

/** From this share of the cap on, the editor and the list say how many code rules are on. */
export const CODE_LIMIT_NEAR = 0.8;

export function codeLimitNear(limit: CodeRuleLimit): boolean {
  return limit.limit > 0 && limit.active >= limit.limit * CODE_LIMIT_NEAR;
}

export function ApplySection({
  ed,
  codeRules,
  pro,
  batches,
  pendingBatch,
}: {
  ed: EditorView;
  codeRules: CodeRuleLimit;
  /** Server-derived Pro entitlement: the generator's pattern fields. */
  pro: boolean;
  /** The generated batches the stored rule has, with their codes. */
  batches: readonly GeneratedBatchView[];
  /** The generator's live spec, when a count is typed: codes will be made on save. */
  pendingBatch?: CodeBatchSpec;
}) {
  const { draft, defaults, errorFor, tr, readOnly } = ed;
  const { t } = tr;
  const off = boolAttr(readOnly);
  const isCode = draft.method === "code";
  const noCode = isCode && !ruleHasCodes(draft) && !pendingBatch;
  return (
    <WonSection
      title={t("editor.section.apply")}
      glyph="code"
      summary={[describeMethod(draft, tr), describeLimits(draft, tr)].filter(Boolean).join(" · ")}
      hint={isCode && codeLimitNear(codeRules) ? t("editor.codeLimit", { active: codeRules.active, limit: codeRules.limit }) : undefined}
      anchor="codes"
    >
      <s-stack direction="block" gap="base">
        <SegmentedChoice
          name={FIELD.method}
          label={t("editor.method.label")}
          defaultValue={defaults.method}
          disabled={readOnly}
          options={[
            { value: "automatic", label: t("editor.method.automatic") },
            { value: "code", label: t("editor.method.code") },
          ]}
        />
        <Shown when={isCode}>
          <s-stack direction="block" gap="base">
            <div>
              <s-text-area
                name={FIELD.codes}
                label={t("editor.codes.own")}
                value={defaults.codes}
                rows={3}
                details={t("editor.codes.details")}
                error={errorFor(FIELD.codes)}
                disabled={off}
              />
              {noCode ? <FieldMark text={t("editor.mark.noCode")} /> : null}
            </div>
            <GeneratedBatches batches={batches} disabled={readOnly} />
            <CodeGenerator pro={pro} pending={pendingBatch} batchCount={draft.codeBatches?.length ?? 0} disabled={readOnly} errorFor={errorFor} />
            <s-stack direction="block" gap="small-200">
              <s-number-field
                name={FIELD.usageLimit}
                label={t("editor.limits.usage")}
                value={defaults.usageLimit}
                min={1}
                inputMode="numeric"
                details={t("editor.limits.usageDetails")}
                error={errorFor(FIELD.usageLimit)}
                disabled={off}
              />
              <s-checkbox name={FIELD.oncePerCustomer} value="on" label={t("editor.limits.once")} checked={boolAttr(defaults.oncePerCustomer)} disabled={off} />
            </s-stack>
          </s-stack>
        </Shown>
      </s-stack>
    </WonSection>
  );
}
