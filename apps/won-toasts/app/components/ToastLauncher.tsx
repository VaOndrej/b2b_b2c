// Status-first, outcome-grouped launcher for the Toasts page (Wave-0 decision).
//
// The old picker was a flat row of every toast type — a merchant read it as
// "a list that says nothing". This groups toasts by what they achieve (cart,
// urgency, social proof, your message) and leads with STATUS: each group shows
// how many of its toasts are live, and each card shows On/Off at a glance. So
// the "list" answers the real question — "what is running on my store, and
// what could I turn on next?" — instead of just enumerating features.
//
// Selecting a card drives the same `selected` state the editor panel reads, so
// this replaces the SegmentedNav without changing the edit flow below it.

import { PlanBadge } from "./PlanBadge";
import { WON_FONT } from "../lib/tokens";

export interface LauncherItem {
  key: string;
  label: string;
  blurb: string;
  pro?: boolean;
  on?: boolean;
}

export interface LauncherGroup {
  id: string;
  title: string;
  caption: string;
  items: LauncherItem[];
}

export function ToastLauncher({
  groups,
  selected,
  onSelect,
}: {
  groups: LauncherGroup[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Toast types" style={{ marginBottom: 12, fontFamily: WON_FONT }}>
      {/* Groups flow side-by-side AND wrap (not one tall column) so the picker
          stays short. Each group is a grid cell; its cards wrap inside it. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {groups.map((group) => {
          return (
            <div key={group.id}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#111418" }}>
                  {group.title}
                </span>
                <span style={{ fontSize: 12.5, color: "#6b7684" }}>{group.caption}</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))",
                  gap: 10,
                }}
              >
                {group.items.map((it) => {
                  const active = selected === it.key;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onSelect(it.key)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 4,
                        textAlign: "left",
                        padding: "9px 12px",
                        minHeight: 68,
                        borderRadius: 12,
                        border: active ? "1.5px solid #1a73e8" : "1px solid #d6dbe1",
                        background: active ? "#f2f7ff" : "#ffffff",
                        boxShadow: active ? "0 2px 8px rgba(26,115,232,.14)" : "0 1px 2px rgba(0,0,0,.04)",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        transition: "border-color .15s ease, background .15s ease, box-shadow .15s ease",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                        {/* On/Off dot reads before any text — the status is the headline. */}
                        <span
                          aria-hidden="true"
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            flex: "0 0 auto",
                            background: it.on ? "#1a8f4b" : "#c3cad2",
                          }}
                        />
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111418", flex: "1 1 auto" }}>
                          {it.label}
                        </span>
                        {it.pro ? <PlanBadge tier="pro" /> : null}
                        {/* On/Off inline (was a 3rd line) — one row shorter per card. */}
                        <span style={{ fontSize: 11, fontWeight: 600, color: it.on ? "#1a8f4b" : "#8a93a0", flex: "0 0 auto" }}>
                          {it.on ? "On" : "Off"}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, lineHeight: 1.3, color: "#586573" }}>
                        {it.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
