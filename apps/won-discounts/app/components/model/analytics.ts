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
  /** Pro: per discount. On Free a labelled example (the frame is locked). */
  rules: AnalyticsRuleRowView[];
  gifts: number;
  outletItems: number;
  /** The rows are an example, not the shop's numbers (Free, or nothing yet). */
  sample: boolean;
}

/** The three numbers of the Přehled card. */
export interface AnalyticsOverviewView {
  available: boolean;
  empty: boolean;
  days: number;
  tiles: AnalyticsTile[];
}
