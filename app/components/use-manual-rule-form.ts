import { useState } from "react";

// MVP_5_1 (move-not-copy): the manual "Add rule / Modify rule" form state machine
// (open/populate/reset a form by id, and broadcast values to AdminCatalogPicker)
// extracted from the app.settings.tsx monolith so the discounts view (and future
// extracted views) share ONE implementation instead of duplicating it.

export const modifyRuleButtonStyle = {
  border: "1px solid rgba(0, 91, 211, 0.24)",
  background: "#f0f7ff",
  color: "#005bd3",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 700,
  padding: "7px 10px",
  cursor: "pointer",
} as const;

export const deleteRuleButtonStyle = {
  border: "1px solid rgba(180, 35, 24, 0.24)",
  background: "#fff4f2",
  color: "#b42318",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 700,
  padding: "7px 10px",
  cursor: "pointer",
} as const;

export type ManualRuleFormValues = Record<
  string,
  string | number | null | undefined
>;

function applyRuleValuesToForm(
  formId: string,
  values: ManualRuleFormValues,
  descriptions: Record<string, string> = {},
) {
  const form = document.getElementById(formId);
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  for (const [name, rawValue] of Object.entries(values)) {
    const value = rawValue == null ? "" : String(rawValue);
    const field = form.elements.namedItem(name);
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    window.dispatchEvent(
      new CustomEvent("admin-catalog-picker:set-value", {
        detail: {
          formId,
          name,
          value,
          description: descriptions[name] ?? value,
        },
      }),
    );
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

export interface ManualRuleFormController {
  openManualRuleForm: string | null;
  setOpenManualRuleForm: (formId: string | null) => void;
  openManualAddForm: (formId: string) => void;
  openManualModifyForm: (
    formId: string,
    values: ManualRuleFormValues,
    descriptions?: Record<string, string>,
  ) => void;
}

export function useManualRuleForm(): ManualRuleFormController {
  const [openManualRuleForm, setOpenManualRuleForm] = useState<string | null>(null);

  function openManualAddForm(formId: string) {
    setOpenManualRuleForm(formId);
    window.requestAnimationFrame(() => {
      const form = document.getElementById(formId);
      if (form instanceof HTMLFormElement) {
        form.reset();
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function openManualModifyForm(
    formId: string,
    values: ManualRuleFormValues,
    descriptions: Record<string, string> = {},
  ) {
    setOpenManualRuleForm(formId);
    window.requestAnimationFrame(() => {
      applyRuleValuesToForm(formId, values, descriptions);
    });
  }

  return {
    openManualRuleForm,
    setOpenManualRuleForm,
    openManualAddForm,
    openManualModifyForm,
  };
}
