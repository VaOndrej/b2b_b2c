// One rule in a list (Přehled "Co běží", Slevy a kódy): name + real state pill,
// the rule's state line, and — when it is not simply live or off — what it is
// instead ("Naplánováno od …", "Uloženo, zatím nepropsáno do Shopify"). §17/A7:
// one row shape, not re-typed per screen.

import type { ReactNode } from "react";

import type { DiscountRule } from "@won/core/discounts/config";

import { useT } from "../i18n/context";
import { describeRuleLine, ruleName } from "./model/describe";
import { needsAttention, statusText, type RuleStatus } from "./model/rule-status";
import { RowNote, StatusPill, WonRow } from "./shell/WonSection";

export function RuleRow({
  rule,
  status,
  currencies,
  timezone,
  action,
  attention,
}: {
  rule: DiscountRule;
  status: RuleStatus;
  currencies: readonly string[];
  timezone: string | null;
  action?: ReactNode;
  /** A problem sentence for this rule (red = needs attention, §11a). */
  attention?: string;
}) {
  const tr = useT();
  const note = statusText(status, tr);
  return (
    <WonRow action={action} tone={attention || needsAttention(status) ? "attention" : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <s-text type="strong">{ruleName(rule, tr)}</s-text>
        <StatusPill status={status} />
      </div>
      <RowNote>{describeRuleLine(rule, tr, currencies, timezone)}</RowNote>
      {note ? <RowNote tone={needsAttention(status) ? "attention" : undefined}>{note}</RowNote> : null}
      {attention ? <RowNote tone="attention">{attention}</RowNote> : null}
    </WonRow>
  );
}
