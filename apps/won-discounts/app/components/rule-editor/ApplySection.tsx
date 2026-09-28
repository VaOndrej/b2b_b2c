// Section "Jak se uplatní": automatically or with codes. The cap on active code
// rules is shown here, before a save would refuse it (§13, C2).

import { describeLimits, describeMethod } from "../model/describe";
import { FIELD } from "../model/rule-form";
import type { CodeRuleLimit } from "../model/types";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { WonSection } from "../shell/WonSection";
import { Shown, type EditorView } from "./parts";

export function ApplySection({ ed, codeRules }: { ed: EditorView; codeRules: CodeRuleLimit }) {
  const { draft, defaults, errorFor, tr } = ed;
  const { t } = tr;
  const isCode = draft.method === "code";
  return (
    <WonSection
      title={t("editor.section.apply")}
      glyph="code"
      summary={[describeMethod(draft, tr), describeLimits(draft, tr)].filter(Boolean).join(" · ")}
      hint={isCode ? t("editor.codeLimit", { active: codeRules.active, limit: codeRules.limit, shopify: codeRules.shopifyLimit }) : undefined}
      anchor="codes"
    >
      <s-stack direction="block" gap="base">
        <SegmentedChoice
          name={FIELD.method}
          label={t("editor.method.label")}
          defaultValue={defaults.method}
          options={[
            { value: "automatic", label: t("editor.method.automatic") },
            { value: "code", label: t("editor.method.code") },
          ]}
        />
        <Shown when={isCode}>
          <s-text-area
            name={FIELD.codes}
            label={t("editor.codes.label")}
            value={defaults.codes}
            rows={3}
            details={t("editor.codes.details")}
            error={errorFor(FIELD.codes)}
          />
        </Shown>
      </s-stack>
    </WonSection>
  );
}
