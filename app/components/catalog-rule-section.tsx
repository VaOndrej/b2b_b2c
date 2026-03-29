import type { ReactNode } from "react";
import { AdminCatalogPicker } from "./admin-catalog-picker";
import type { CatalogResourceType } from "./admin-catalog-picker.shared";
import { CompactRulePanel } from "./compact-rule-panel";
import type { CatalogRuleItem } from "./compact-rule-panel";

export type { CatalogRuleItem } from "./compact-rule-panel";

export interface CatalogRuleSectionProps {
  heading: string;
  description?: string;
  resourceType: CatalogResourceType;
  pickerLabel: string;
  pickerName: string;
  saveIntent: string;
  deleteIntent: string;
  submitLabel: string;
  emptyMessage: string;
  rulesHeading: string;
  isSubmitting: boolean;
  items: CatalogRuleItem[];
  children?: ReactNode;
}

export function CatalogRuleSection(props: CatalogRuleSectionProps) {
  return (
    <CompactRulePanel
      heading={props.heading}
      description={props.description}
      saveIntent={props.saveIntent}
      submitLabel={props.submitLabel}
      deleteIntent={props.deleteIntent}
      deleteFieldName="ruleId"
      rulesHeading={props.rulesHeading}
      emptyMessage={props.emptyMessage}
      isSubmitting={props.isSubmitting}
      items={props.items}
    >
      <div style={{ gridColumn: "1 / -1" }}>
        <s-stack direction="block" gap="base">
          <AdminCatalogPicker
            name={props.pickerName}
            label={props.pickerLabel}
            resourceType={props.resourceType}
            required
          />
          {props.children}
        </s-stack>
      </div>
    </CompactRulePanel>
  );
}
