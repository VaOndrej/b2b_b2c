// "Vaše slevy" as one table (Ondřej, 31 Oct 2026): a tab per state, a search, a filter by how the discount applies and
// a sort; a row opens the discount, at the field that fixes it when it needs attention (P3). The choices live on this
// page only and nothing is fetched: model/rule-table.ts picks the rows.

import { useMemo, useState, type CSSProperties } from "react";

import { useT } from "../i18n/context";
import { ruleTabCounts, visibleRules, type RuleMethodFilter, type RuleSort, type RuleTab, type RuleTableRow } from "./model/rule-table";
import { needsAttention, statusText } from "./model/rule-status";
import { hoverMark } from "./shell/hover";
import { WON_ATTENTION, WON_EDGE, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./shell/tokens";
import { StatusPill } from "./shell/WonSection";

const TABLE_CSS = `
.won-rt__row{display:grid;grid-template-columns:minmax(0,1.5fr) 140px 180px 150px;gap:4px 14px;align-items:center;padding:11px 16px}
.won-rt__tab,.won-rt__sort{font:inherit;border:0;background:transparent;cursor:pointer}
.won-rt__tab{font-size:13px;font-weight:500;padding:4px 10px;border-radius:7px;color:${WON_MUTED}}
.won-rt__tab[aria-pressed="true"]{background:#e9ebee;color:${WON_INK};font-weight:600}
.won-rt__sort{all:unset;display:inline-flex;align-items:center;gap:4px;cursor:pointer;border-radius:4px}
.won-rt__sort:hover,.won-rt__sort[data-on]{color:${WON_INK}}
.won-rt__sort:focus-visible,.won-rt__tab:focus-visible{outline:2px solid ${WON_SELECT};outline-offset:2px}
.won-rt__search:focus-within,.won-rt__select:focus-within{border-color:${WON_SELECT};box-shadow:0 0 0 2px rgba(26,115,232,.15)}
@media (max-width:640px){.won-rt__row{grid-template-columns:minmax(0,1fr) auto}.won-rt__opt{display:none}}
`;

const FIELD: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 10px", border: `1px solid ${WON_EDGE}`, borderRadius: 8, background: WON_SURFACE, fontSize: 13, color: WON_MUTED };
const SELECT: CSSProperties = { border: 0, background: "transparent", font: "inherit", fontWeight: 600, color: WON_INK, cursor: "pointer", outline: 0, padding: 0 };
const TABS: readonly RuleTab[] = ["all", "attention", "live", "scheduled", "off", "ended"];
const SORTS: readonly RuleSort[] = ["state", "name", "method", "until"];

export function RuleTable({ rows }: { rows: readonly RuleTableRow[] }) {
  const tr = useT();
  const { t } = tr;
  const [tab, setTab] = useState<RuleTab>("all");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<RuleMethodFilter>("all");
  const [sort, setSort] = useState<RuleSort>("state");
  const [dir, setDir] = useState<1 | -1>(1);
  const counts = useMemo(() => ruleTabCounts(rows), [rows]);
  // These two tabs show only with something in them: when the last one goes, the merchant is not left on a missing tab.
  const current = (tab === "attention" || tab === "ended") && counts[tab] === 0 ? "all" : tab;
  const shown = useMemo(() => visibleRules(rows, { tab: current, query, method, sort, dir }, tr.locale), [rows, current, query, method, sort, dir, tr.locale]);
  const clear = () => {
    setTab("all");
    setQuery("");
    setMethod("all");
  };
  const head = (key: RuleSort) => (
    <button
      type="button"
      className="won-rt__sort"
      data-won-rt-sort={key}
      {...(sort === key ? { "data-on": "" } : {})}
      onClick={() => {
        setDir(sort === key ? (dir === 1 ? -1 : 1) : 1);
        setSort(key);
      }}
    >
      {t(`discounts.table.col.${key}`)}
      {sort === key ? <span aria-hidden="true">{dir === 1 ? "↑" : "↓"}</span> : null}
    </button>
  );

  return (
    <div data-won-rule-table="" style={{ border: `1px solid ${WON_EDGE}`, borderRadius: 12, overflow: "hidden", background: WON_SURFACE, fontFamily: WON_FONT }}>
      <style dangerouslySetInnerHTML={{ __html: TABLE_CSS }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: 6, borderBottom: `1px solid ${WON_LINE}` }}>
        {/* A tab with nothing in it is hidden only where it says a rare state: the usual three stay, so the row does not jump. */}
        {TABS.filter((key) => (key !== "attention" && key !== "ended") || counts[key] > 0).map((key) => (
          <button key={key} type="button" className="won-rt__tab" data-won-rt-tab={key} aria-pressed={key === current} onClick={() => setTab(key)}>
            {t(`discounts.table.tab.${key}`)} {counts[key]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", padding: "10px 12px", borderBottom: `1px solid ${WON_LINE}` }}>
        <label className="won-rt__search" style={{ display: "flex", alignItems: "center", gap: 7, flex: "1 1 220px", minWidth: 0, padding: "6px 10px", border: `1px solid ${WON_EDGE}`, borderRadius: 8, background: WON_SURFACE }}>
          <svg aria-hidden="true" viewBox="0 0 18 18" width="15" height="15" fill="none" stroke={WON_MUTED} strokeWidth="1.8" strokeLinecap="round" style={{ flex: "0 0 auto" }}>
            <circle cx="8" cy="8" r="5" />
            <path d="M12 12l3.5 3.5" />
          </svg>
          <input type="search" data-won-rt-search="" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("discounts.table.search")} aria-label={t("discounts.table.search")} style={{ all: "unset", flex: 1, minWidth: 0, fontSize: 13.5 }} />
        </label>
        <label className="won-rt__select" style={FIELD}>
          {t("discounts.table.method")}
          <select data-won-rt-method="" value={method} onChange={(event) => setMethod(event.target.value as RuleMethodFilter)} style={SELECT}>
            <option value="all">{t("discounts.table.method.all")}</option>
            <option value="code">{t("discounts.table.method.code")}</option>
            <option value="auto">{t("discounts.table.method.auto")}</option>
          </select>
        </label>
        <label className="won-rt__select" style={FIELD}>
          {t("discounts.table.sort")}
          <select
            data-won-rt-order=""
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as RuleSort);
              setDir(1);
            }}
            style={SELECT}
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {t(`discounts.table.col.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="won-rt__row" style={{ paddingBlock: 7, fontSize: 12, fontWeight: 600, color: WON_MUTED, background: WON_WASH }}>
        <div>{head("name")}</div>
        <div className="won-rt__opt">{head("method")}</div>
        <div className="won-rt__opt">{head("until")}</div>
        <div>{head("state")}</div>
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: "14px 16px", fontSize: 13, color: WON_MUTED }}>
          {t("discounts.table.none")}{" "}
          <button type="button" onClick={clear} data-won-rt-clear="" {...hoverMark("link")} style={{ all: "unset", cursor: "pointer", color: WON_SELECT, fontWeight: 500 }}>
            {t("discounts.table.clear")}
          </button>
        </div>
      ) : (
        shown.map((row, i) => {
          const note = statusText(row.status, tr);
          return (
            <s-clickable key={row.id} href={row.href}>
              <div className="won-rt__row" data-won-rule-row={row.id} {...hoverMark("line")} style={{ borderTop: i === 0 ? "none" : `1px solid ${WON_LINE}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: WON_INK }}>{row.name}</div>
                  <div style={{ fontSize: 13, color: WON_MUTED }}>{row.what}</div>
                  {/* Not the scheduled sentence: the column "Platí" says when it starts. */}
                  {note && row.status.kind !== "scheduled" && row.status.kind !== "ended" ? <div style={{ fontSize: 13, fontWeight: needsAttention(row.status) ? 500 : 400, color: needsAttention(row.status) ? WON_ATTENTION : WON_MUTED }}>{note}</div> : null}
                  {row.attention ? <div style={{ fontSize: 13, fontWeight: 500, color: WON_ATTENTION }}>{row.attention}</div> : null}
                </div>
                <div className="won-rt__opt" style={{ fontSize: 13, color: WON_MUTED }}>{row.how}</div>
                <div className="won-rt__opt" style={{ fontSize: 13, color: WON_MUTED }}>{row.valid}</div>
                <div>
                  <StatusPill status={row.status} />
                </div>
              </div>
            </s-clickable>
          );
        })
      )}
    </div>
  );
}
