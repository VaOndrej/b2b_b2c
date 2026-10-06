// Přehledy (MVP 7, contract M4) — the view model of the reports screen, worded on the server.

export interface AnalyticsTile {
  /** i18n key suffix: orders | discounted | cost | average. */
  id: "orders" | "discounted" | "cost" | "average";
  value: string;
}

export interface AnalyticsDay {
  /** "3. 10." */
  label: string;
  /** Bar height, 0–100 (the range's costliest day = 100). */
  height: number;
  /** "3. 10.: slevy 120 Kč, 4 objednávky" (the bar's title). */
  title: string;
}

export interface AnalyticsRuleRowView {
  key: string;
  name: string;
  orders: number;
  cost: string;
  revenue: string;
  /** 0–100: its cost against the costliest row (the bar). */
  share: number;
  /** Where the row is set up: the discount's editor (the key is a discount that still exists), Množstevní slevy, Odměny. */
  href?: string;
}

export interface AnalyticsScreenData {
  plan: "free" | "pro";
  /** The app may read orders (Shopify approved protected customer data access). */
  available: boolean;
  days: number;
  /** No order in the range. */
  empty: boolean;
  tiles: AnalyticsTile[];
  series: AnalyticsDay[];
  /** Orders in another currency than the sums' (left out). */
  otherCurrencyOrders: number;
  /** Those currencies by code, when known (P4: named, not only counted). */
  otherCurrencies?: string[];
  /** Pro: per discount (empty = no order with a discount yet). On Free a labelled example in the locked frame. */
  rules: AnalyticsRuleRowView[];
  gifts: number;
  outletItems: number;
  /** The rows are an example, not the shop's numbers: only on Free, inside the locked frame, in the shop currency. */
  sample: boolean;
}

/** The three numbers of the Přehled card. */
export interface AnalyticsOverviewView {
  available: boolean;
  empty: boolean;
  days: number;
  tiles: AnalyticsTile[];
}
