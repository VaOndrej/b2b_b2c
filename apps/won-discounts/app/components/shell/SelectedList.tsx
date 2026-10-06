// What a setting points at, as a list (P4): every selected product, variant or
// collection by name with a small image, one row each, removable. A count alone
// ("3 produkty") never tells the merchant whether the first product is still
// there. Long lists get a filter and show the first rows until asked for all.
// Presentational: the caller owns the ids (hidden inputs) and the labels.

import { useState, type ReactNode } from "react";

import { useT } from "../../i18n/context";
import { WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "./tokens";

export interface SelectedItem {
  id: string;
  /** Empty when Shopify no longer knows the id: the row says so. */
  title: string;
  image?: string;
}

/** Rows shown before "Zobrazit všech N"; from this many on the list can be filtered. */
export const SELECTED_SHOWN = 8;

export function SelectedList({
  items,
  fallback,
  onRemove,
  disabled = false,
  extra,
}: {
  items: readonly SelectedItem[];
  /** The name of a row without a title ("Produkt bez názvu"). */
  fallback: string;
  /** Absent: the rows cannot be removed here. */
  onRemove?: (id: string) => void;
  disabled?: boolean;
  /** A control at the end of a row (the per-item minimum). */
  extra?: (item: SelectedItem) => ReactNode;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const long = items.length > SELECTED_SHOWN;
  const needle = query.trim().toLocaleLowerCase();
  const matching = needle ? items.filter((item) => (item.title || fallback).toLocaleLowerCase().includes(needle)) : items;
  const shown = all || needle ? matching : matching.slice(0, SELECTED_SHOWN);
  return (
    <div data-won-selected style={{ fontFamily: WON_FONT, display: "flex", flexDirection: "column", gap: 6 }}>
      {long ? (
        <input
          type="search"
          // Uncontrolled on purpose: the screens re-render from a native `input` listener on the
          // form, which runs before React's own handler — a controlled value would be put back.
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("selected.filter", { n: items.length })}
          aria-label={t("selected.filter", { n: items.length })}
          style={{ font: "inherit", fontSize: 13, padding: "6px 10px", border: `1px solid ${WON_LINE}`, borderRadius: 8, background: WON_SURFACE, color: WON_INK, maxWidth: 320 }}
        />
      ) : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${WON_LINE}`, borderRadius: 10, background: WON_SURFACE, overflow: "hidden" }}>
        {shown.map((item, index) => (
          <li
            key={item.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderTop: index === 0 ? "none" : `1px solid ${WON_LINE}`, minHeight: 40 }}
          >
            {item.image ? (
              <img src={item.image} alt="" width={28} height={28} loading="lazy" style={{ flex: "0 0 auto", borderRadius: 6, objectFit: "cover", border: `1px solid ${WON_LINE}` }} />
            ) : (
              <span aria-hidden="true" style={{ flex: "0 0 auto", width: 28, height: 28, borderRadius: 6, background: WON_WASH, border: `1px solid ${WON_LINE}` }} />
            )}
            <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, color: item.title ? WON_INK : WON_MUTED, overflowWrap: "anywhere" }}>{item.title || fallback}</span>
            {extra ? <span style={{ flex: "0 0 auto" }}>{extra(item)}</span> : null}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                disabled={disabled}
                aria-label={t("selected.remove", { name: item.title || fallback })}
                title={t("selected.remove", { name: item.title || fallback })}
                style={{ flex: "0 0 auto", width: 28, height: 28, border: "none", borderRadius: 6, background: "transparent", color: disabled ? WON_FAINT : WON_MUTED, cursor: disabled ? "default" : "pointer", fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
        {shown.length === 0 ? <li style={{ padding: "8px 10px", fontSize: 13, color: WON_MUTED }}>{t("selected.noMatch")}</li> : null}
      </ul>
      {long && !needle ? (
        <div>
          <button
            type="button"
            onClick={() => setAll((value) => !value)}
            style={{ border: "none", background: "transparent", padding: 0, font: "inherit", fontSize: 13, color: WON_INK, textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}
          >
            {all ? t("selected.showLess") : t("selected.showAll", { n: items.length })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
