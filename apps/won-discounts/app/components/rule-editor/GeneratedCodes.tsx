// Generated codes (plan 2026-10-06, bod 6; core code-batch.ts).
//
//   GeneratedBatches  the batches the rule already has: each one's pattern and
//                     count, its codes as a list (filter, show all), copy all,
//                     download as CSV, delete one code or the whole batch.
//                     Deleting is part of the form (hidden `dropBatch` /
//                     `dropBatchCode` inputs): nothing changes until Save.
//   CodeGenerator     "Vygenerovat kódy": how many (Free up to 100, random),
//                     and on Pro the pattern — prefix, middle, suffix, the
//                     length and the characters of the random part — with a
//                     live sample. The codes are made by the server on Save
//                     (it draws the seed and checks the shop's other codes).
//
// The seed of a batch never reaches the browser: the loader sends the codes.

import { useState } from "react";

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { CODE_BATCH_DEFAULTS, codeBatchMinLength, codeBatchPattern, type CodeBatchSpec } from "@won/core/discounts/code-batch";

import { useT } from "../../i18n/context";
import { FIELD } from "../model/rule-form";
import type { GeneratedBatchView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { hoverMark } from "../shell/hover";
import { PlanBadge } from "../shell/PlanBadge";
import { ProFrame } from "../shell/ProFrame";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { RowNote } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "../shell/tokens";
import { FieldGrid, FieldMessage } from "./parts";

/** Codes shown before "Zobrazit všech N"; from this many on the list can be filtered. */
const CODES_SHOWN = 8;

/** A native change on the form: the App Bridge save bar and the live draft both listen for it. */
function touchForm(el: HTMLElement | null) {
  window.setTimeout(() => el?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true })), 0);
}

const linkButton = {
  border: "none",
  background: "transparent",
  padding: 0,
  font: "inherit",
  fontSize: 13,
  color: WON_INK,
  textDecoration: "underline",
  textUnderlineOffset: 2,
  cursor: "pointer",
} as const;

function BatchCard({ batch, disabled }: { batch: GeneratedBatchView; disabled: boolean }) {
  const tr = useT();
  const { t } = tr;
  const [gone, setGone] = useState<string[]>([]);
  const [dropped, setDropped] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const left = batch.codes.filter((code) => !gone.includes(code));
  const needle = query.trim().toUpperCase();
  const matching = needle ? left.filter((code) => code.includes(needle)) : left;
  const shown = all || needle ? matching : matching.slice(0, CODES_SHOWN);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(left.join("\n"));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  const csv = `data:text/csv;charset=utf-8,${encodeURIComponent(["code", ...left].join("\n"))}`;
  return (
    <div data-won-batch={batch.id} style={{ fontFamily: WON_FONT, border: `1px solid ${WON_LINE}`, borderRadius: 10, background: WON_SURFACE, padding: 10, display: "flex", flexDirection: "column", gap: 8, opacity: dropped ? 0.6 : 1 }}>
      {dropped ? <input type="hidden" name={FIELD.dropBatch} value={batch.id} /> : null}
      {!dropped ? gone.map((code) => <input key={code} type="hidden" name={FIELD.dropBatchCode} value={`${batch.id}|${code}`} />) : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: WON_INK, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{batch.pattern}</span>
        <span style={{ fontSize: 12.5, color: WON_MUTED }}>{tr.tp("count.code", left.length)}</span>
        {batch.pro ? <PlanBadge tier="pro" /> : null}
      </div>
      {dropped ? (
        <div style={{ fontSize: 12.5, color: WON_ATTENTION }}>
          {t("editor.batch.dropped")}{" "}
          <button type="button" {...hoverMark("link")} style={linkButton} onClick={(event) => { setDropped(false); touchForm(event.currentTarget); }}>
            {t("editor.batch.keep")}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center" }}>
            <button type="button" {...hoverMark("link")} style={linkButton} onClick={copy}>
              {t("editor.batch.copy")}
            </button>
            <a href={csv} download={`${batch.pattern.replace(/[^A-Za-z0-9_-]+/g, "") || "kody"}.csv`} style={{ ...linkButton, display: "inline-block" }}>
              {t("editor.batch.csv")}
            </a>
            {!disabled ? (
              <button type="button" {...hoverMark("link")} style={{ ...linkButton, color: WON_ATTENTION }} onClick={(event) => { setDropped(true); touchForm(event.currentTarget); }}>
                {t("editor.batch.drop")}
              </button>
            ) : null}
            {copied ? <span style={{ fontSize: 12.5, color: copied === "ok" ? WON_MUTED : WON_ATTENTION }}>{t(copied === "ok" ? "editor.batch.copied" : "editor.batch.copyFailed")}</span> : null}
          </div>
          {left.length > CODES_SHOWN ? (
            <input
              type="search"
              // Uncontrolled: the editor re-renders from a native `input` listener on the form (see SelectedList).
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("editor.batch.filter", { n: left.length })}
              aria-label={t("editor.batch.filter", { n: left.length })}
              style={{ font: "inherit", fontSize: 13, padding: "6px 10px", border: `1px solid ${WON_LINE}`, borderRadius: 8, background: WON_SURFACE, color: WON_INK, maxWidth: 320 }}
            />
          ) : null}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 4 }}>
            {shown.map((code) => (
              <li key={code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, background: WON_WASH, borderRadius: 6, padding: "3px 4px 3px 8px", fontSize: 13, color: WON_INK, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ overflowWrap: "anywhere" }}>{code}</span>
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={t("editor.batch.removeCode", { code })}
                    title={t("editor.batch.removeCode", { code })}
                    onClick={(event) => { setGone((list) => [...list, code]); touchForm(event.currentTarget); }}
                    {...hoverMark("icon")}
                    style={{ flex: "0 0 auto", width: 24, height: 24, border: "none", borderRadius: 6, background: "transparent", color: WON_MUTED, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {shown.length === 0 ? <div style={{ fontSize: 13, color: WON_MUTED }}>{t(left.length === 0 ? "editor.batch.allRemoved" : "selected.noMatch")}</div> : null}
          {left.length > CODES_SHOWN && !needle ? (
            <div>
              <button type="button" {...hoverMark("link")} style={linkButton} onClick={() => setAll((value) => !value)}>
                {all ? t("selected.showLess") : t("selected.showAll", { n: left.length })}
              </button>
            </div>
          ) : null}
          {gone.length > 0 ? <div style={{ fontSize: 12.5, color: WON_ATTENTION }}>{tr.tp("editor.batch.goneOnSave", gone.length)}</div> : null}
        </>
      )}
    </div>
  );
}

export function GeneratedBatches({ batches, disabled }: { batches: readonly GeneratedBatchView[]; disabled: boolean }) {
  const { t } = useT();
  if (batches.length === 0) return null;
  return (
    <s-stack direction="block" gap="small-200">
      <s-text type="strong">{t("editor.batch.title")}</s-text>
      {batches.map((batch) => (
        <BatchCard key={batch.id} batch={batch} disabled={disabled} />
      ))}
    </s-stack>
  );
}

/** The sample of what will be generated: the pattern with X for every random character ("BF-XXXXX-XXXXX-VIP"). */
export function batchSample(spec: CodeBatchSpec | undefined, pro: boolean): string {
  const alphabet = (pro && spec?.alphabet) || CODE_BATCH_DEFAULTS.alphabet;
  const count = spec && Number.isInteger(spec.count) && spec.count > 0 ? spec.count : 1;
  const shortest = Math.max(CODE_BATCH_DEFAULTS.length, codeBatchMinLength(alphabet, count));
  const asked = pro && spec?.length && Number.isInteger(spec.length) ? spec.length : shortest;
  return codeBatchPattern({
    // Without an own prefix the server draws four letters and a dash.
    prefix: (pro && spec?.prefix) || "ABCD-",
    length: Math.min(Math.max(asked, shortest), CONFIG_LIMITS.codeBatchRandomLength),
    alphabet,
    ...(pro && spec?.middle ? { middle: spec.middle } : {}),
    ...(pro && spec?.suffix ? { suffix: spec.suffix } : {}),
  });
}

export function CodeGenerator({
  pro,
  pending,
  batchCount,
  disabled,
  errorFor,
}: {
  pro: boolean;
  /** The generator's live spec (the editor's draft parse), when a count is typed. */
  pending: CodeBatchSpec | undefined;
  /** Batches the rule already has (after the ones marked for deletion): the cap is per rule. */
  batchCount: number;
  disabled: boolean;
  errorFor: (field: string) => string | undefined;
}) {
  const tr = useT();
  const { t } = tr;
  const off = boolAttr(disabled);
  const max = pro ? CONFIG_LIMITS.codeBatchSize : CONFIG_LIMITS.codeBatchSizeFree;
  const full = batchCount >= CONFIG_LIMITS.codeBatchesPerRule;
  const lockedPattern = boolAttr(disabled || !pro);
  const pattern = (
    <s-stack direction="block" gap="small-200">
      <FieldGrid>
        <div>
          <s-text-field name={FIELD.batchPrefix} label={t("editor.generate.prefix")} placeholder="BF-" maxLength={CONFIG_LIMITS.codeBatchLiteralLength} disabled={lockedPattern} />
          <FieldMessage text={errorFor(FIELD.batchPrefix)} />
        </div>
        <div>
          <s-text-field name={FIELD.batchMiddle} label={t("editor.generate.middle")} placeholder="-" maxLength={CONFIG_LIMITS.codeBatchLiteralLength} disabled={lockedPattern} />
          <FieldMessage text={errorFor(FIELD.batchMiddle)} />
        </div>
        <div>
          <s-text-field name={FIELD.batchSuffix} label={t("editor.generate.suffix")} placeholder="-VIP" maxLength={CONFIG_LIMITS.codeBatchLiteralLength} disabled={lockedPattern} />
          <FieldMessage text={errorFor(FIELD.batchSuffix)} />
        </div>
        <div>
          <s-number-field name={FIELD.batchLength} label={t("editor.generate.length")} placeholder={String(CODE_BATCH_DEFAULTS.length)} min={4} max={CONFIG_LIMITS.codeBatchRandomLength} inputMode="numeric" disabled={lockedPattern} />
          <FieldMessage text={errorFor(FIELD.batchLength)} />
        </div>
      </FieldGrid>
      <SegmentedChoice
        name={FIELD.batchAlphabet}
        label={t("editor.generate.alphabet")}
        defaultValue="both"
        disabled={disabled || !pro}
        options={[
          { value: "both", label: t("editor.generate.alphabet.both") },
          { value: "letters", label: t("editor.generate.alphabet.letters") },
          { value: "digits", label: t("editor.generate.alphabet.digits") },
        ]}
      />
      <RowNote>{t("editor.generate.patternHint")}</RowNote>
    </s-stack>
  );
  return (
    <div data-won-generator style={{ fontFamily: WON_FONT, border: `1px solid ${WON_LINE}`, borderRadius: 10, background: WON_WASH, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <s-text type="strong">{t("editor.generate.title")}</s-text>
      {full ? (
        <RowNote>{t("editor.generate.full", { max: CONFIG_LIMITS.codeBatchesPerRule })}</RowNote>
      ) : (
        <>
          <div style={{ maxWidth: 240 }}>
            <s-number-field name={FIELD.batchCount} label={t("editor.generate.count")} placeholder="100" min={1} max={max} inputMode="numeric" disabled={off} />
            <FieldMessage text={errorFor(FIELD.batchCount)} />
          </div>
          <RowNote>{t(pro ? "editor.generate.countHintPro" : "editor.generate.countHintFree", { max })}</RowNote>
          {pro ? (
            pattern
          ) : (
            <s-stack direction="block" gap="small-200">
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <PlanBadge tier="pro" locked href="/app/plan" />
                <RowNote>{t("editor.generate.proBenefit")}</RowNote>
              </div>
              <ProFrame locked>{pattern}</ProFrame>
            </s-stack>
          )}
          <div style={{ fontSize: 13, color: WON_INK }}>
            {pending ? tr.tp("editor.generate.onSave", pending.count) : t("editor.generate.sampleLabel")}{" "}
            <span data-won-sample style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{batchSample(pending, pro)}</span>
          </div>
        </>
      )}
    </div>
  );
}
