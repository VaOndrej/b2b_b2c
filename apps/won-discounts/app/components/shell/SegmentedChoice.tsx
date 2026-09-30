// A segmented single-choice control built on NATIVE radio inputs (doctrine §7b
// picker shape, §2 binding): the browser fires real input/change events that
// bubble to the form, so the live summary re-reads the form like for any Polaris
// field, and the chosen value submits with the form. The selected segment uses
// the shared selection treatment (§11b: blue = selected, from one source).

import { useId, useState } from "react";

import { PlanBadge } from "./PlanBadge";
import { WON_FONT, WON_INK, WON_MUTED, WON_SELECT } from "./tokens";

export interface ChoiceOption {
  value: string;
  label: string;
  /** This option cannot be picked (a Pro option on Free, §16a: visible, never hidden). */
  disabled?: boolean;
  /** Pro option: the amber plan marker next to its label (§16b). */
  pro?: boolean;
}

export function SegmentedChoice({
  name,
  label,
  options,
  defaultValue,
  disabled = false,
}: {
  name: string;
  label: string;
  options: readonly ChoiceOption[];
  defaultValue: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const labelId = useId();
  return (
    <div style={{ fontFamily: WON_FONT }}>
      <div id={labelId} style={{ fontSize: 13, fontWeight: 500, color: WON_INK, marginBottom: 6 }}>
        {label}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        style={{
          display: "inline-flex",
          flexWrap: "wrap",
          gap: 4,
          padding: 4,
          background: "#e9edf1",
          border: "1px solid #d3d9e0",
          borderRadius: 12,
          maxWidth: "100%",
        }}
      >
        {options.map((option) => {
          const active = option.value === value;
          const off = disabled || option.disabled === true;
          return (
            <label
              key={option.value}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 13px",
                borderRadius: 9,
                cursor: off ? "not-allowed" : "pointer",
                background: active ? "#ffffff" : "transparent",
                border: active ? "1px solid #c4cad2" : "1px solid transparent",
                boxShadow: active ? "0 1px 4px rgba(0,0,0,.14)" : "none",
                fontSize: 13,
                fontWeight: active ? 700 : 600,
                color: active ? WON_INK : WON_MUTED,
                opacity: off ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                disabled={off}
                onChange={() => setValue(option.value)}
                style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
              />
              {active ? (
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: WON_SELECT }} />
              ) : null}
              {option.label}
              {option.pro ? <PlanBadge tier="pro" locked={option.disabled === true} /> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
