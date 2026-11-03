// The table "Vaše slevy": what a row says and how the tabs, the search, the filter and the sort pick and order the
// rows. No state of its own and nothing fetched: every row is already on the page.

import { needsAttention, runsNow, type RuleStatus } from "./rule-status";

export type RuleTab = "all" | "attention" | "live" | "scheduled" | "off" | "ended";
export type RuleSort = "state" | "name" | "method" | "until";
export type RuleMethodFilter = "all" | "code" | "auto";

export interface RuleTableRow {
  id: string;
  name: string;
  /** What the discount gives. */
  what: string;
  how: string;
  code: boolean;
  /** "Do 30. 11."; the sort reads `until`. */
  valid: string;
  /** The last day, `YYYY-MM-DD`; null = no end. */
  until: string | null;
  status: RuleStatus;
  /** A problem sentence: the row counts as needing attention even when the rule runs (a market without an amount). */
  attention?: string;
  href: string;
}

export interface RuleTableView {
  tab: RuleTab;
  query: string;
  method: RuleMethodFilter;
  sort: RuleSort;
  /** 1 = ascending, -1 = descending. */
  dir: 1 | -1;
}

/** Something to fix: on top of its state, so a scheduled rule with a gap is under "Naplánované" too, as its label says. */
export function ruleNeedsFixing(row: Pick<RuleTableRow, "status" | "attention">): boolean {
  return row.attention !== undefined || needsAttention(row.status);
}

/** The state tab of a row; null = only under "Vše" (on its way to Shopify, a draft). */
export function ruleTabOf(row: Pick<RuleTableRow, "status">): Exclude<RuleTab, "all" | "attention"> | null {
  if (runsNow(row.status)) return "live";
  if (row.status.kind === "scheduled") return "scheduled";
  if (row.status.kind === "off") return "off";
  if (row.status.kind === "ended") return "ended";
  return null;
}

const inTab = (row: RuleTableRow, tab: RuleTab) => tab === "all" || (tab === "attention" ? ruleNeedsFixing(row) : ruleTabOf(row) === tab);

const TAB_ORDER: Readonly<Record<string, number>> = { live: 1, scheduled: 2, off: 3, ended: 4 };
const stateRank = (row: RuleTableRow) => (ruleNeedsFixing(row) ? 0 : (TAB_ORDER[ruleTabOf(row) ?? ""] ?? 5));

export function ruleTabCounts(rows: readonly RuleTableRow[]): Record<RuleTab, number> {
  const count = (tab: RuleTab) => rows.filter((row) => inTab(row, tab)).length;
  return { all: rows.length, attention: count("attention"), live: count("live"), scheduled: count("scheduled"), off: count("off"), ended: count("ended") };
}

export function visibleRules(rows: readonly RuleTableRow[], view: RuleTableView, locale: string): RuleTableRow[] {
  const needle = view.query.trim().toLocaleLowerCase(locale);
  const text = (a: string, b: string) => a.localeCompare(b, locale);
  const by: Record<RuleSort, (a: RuleTableRow, b: RuleTableRow) => number> = {
    state: (a, b) => stateRank(a) - stateRank(b),
    name: (a, b) => text(a.name, b.name),
    method: (a, b) => text(a.how, b.how),
    // A rule without an end comes last: it ends after every other.
    until: (a, b) => text(a.until ?? "9999", b.until ?? "9999"),
  };
  return rows
    .filter((row) => inTab(row, view.tab))
    .filter((row) => view.method === "all" || row.code === (view.method === "code"))
    .filter((row) => !needle || `${row.name} ${row.what} ${row.how}`.toLocaleLowerCase(locale).includes(needle))
    .sort((a, b) => view.dir * by[view.sort](a, b) || text(a.name, b.name));
}
