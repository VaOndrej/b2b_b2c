// MVP12 — social proof ("Anna from Praha bought a Mug"). Privacy-first and
// cold-start honest: we store ONLY a first name + city + product title from a
// REAL order, never fabricate sales, and don't switch the feed on until the
// shop has enough genuine orders. GDPR customers/redact drops a customer's rows.

/** The only fields we ever persist from an order. No last name, email, address. */
export interface AnonymizedSale {
  firstName: string | null;
  city: string | null;
  productTitle: string | null;
  /** Kept solely so customers/redact can delete this shopper's events. */
  customerId: string | null;
  /** Event time (epoch ms). */
  at: number;
}

const OPT_OUT_ATTR = "won_social_optout";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function truthy(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
function cap(value: string | null, max = 40): string | null {
  if (!value) return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Reduce a raw orders/create payload to an anonymized sale — or null when the
 * order opted out. Everything beyond first name + city + first product title is
 * dropped here, so nothing sensitive is ever stored or shipped to a storefront.
 */
export function anonymizeOrder(
  payload: unknown,
  nowMs: number,
): AnonymizedSale | null {
  if (!isPlainObject(payload)) return null;

  const notes = payload.note_attributes;
  if (
    Array.isArray(notes) &&
    notes.some(
      (n) =>
        isPlainObject(n) &&
        str(n.name).toLowerCase() === OPT_OUT_ATTR &&
        truthy(n.value),
    )
  ) {
    return null;
  }

  const customer = isPlainObject(payload.customer) ? payload.customer : {};
  const ship = isPlainObject(payload.shipping_address)
    ? payload.shipping_address
    : {};
  const bill = isPlainObject(payload.billing_address)
    ? payload.billing_address
    : {};

  const firstName =
    str(customer.first_name) || str(ship.first_name) || str(bill.first_name) || null;
  const city = str(ship.city) || str(bill.city) || null;

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const first = lineItems.length && isPlainObject(lineItems[0]) ? lineItems[0] : null;
  const productTitle = first ? str(first.title) || null : null;

  const customerId = customer.id != null ? String(customer.id) : null;
  const parsed = Date.parse(str(payload.created_at));
  const at = Number.isFinite(parsed) ? parsed : nowMs;

  return {
    firstName: cap(firstName),
    city: cap(city),
    productTitle: cap(productTitle, 80),
    customerId,
    at,
  };
}

/** Cold-start honesty: enable the feed only once real orders reach the threshold. */
export function coldStartReady(orderCount: number, minOrders: number): boolean {
  return orderCount >= Math.max(1, Math.floor(minOrders) || 0);
}

/** GDPR redact: drop every event belonging to a customer id. */
export function redactSales<T extends { customerId: string | null }>(
  sales: readonly T[],
  customerId: string | number,
): T[] {
  const target = String(customerId);
  return sales.filter((s) => String(s.customerId) !== target);
}

/**
 * Render a sale line. Missing name/city collapse gracefully — no "undefined",
 * no dangling "from ". `showName`/`showCity` let a merchant suppress a field.
 */
export function formatSaleMessage(
  template: string,
  sale: Pick<AnonymizedSale, "firstName" | "city" | "productTitle">,
): string {
  let t = String(template ?? "");
  const name = (sale.firstName ?? "").trim();
  const city = (sale.city ?? "").trim();
  const product = (sale.productTitle ?? "").trim();

  if (!city) t = t.replace(/\s*from\s+\{city\}/gi, "");
  t = t
    .replace(/\{name\}/g, name || "Someone")
    .replace(/\{city\}/g, city)
    .replace(/\{product\}/g, product || "an item");
  return t.replace(/\s{2,}/g, " ").trim();
}
