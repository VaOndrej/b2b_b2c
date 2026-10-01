import type { Locator, Page } from "@playwright/test";

import { expect } from "./fixtures.ts";

// Shopify's own checkout / thank-you page (not the theme). Money is read from
// its two structured tables, both `role="table"` labelled by a heading:
//   - the line items  (aria-labelledby "ResourceList…"): per line the title,
//     each discount allocation ("<title> (-21,80 Kč)") and the original /
//     reduced price;
//   - the price summary (aria-labelledby "MoneyLine-Heading…"): subtotal,
//     order discounts (one row per code), shipping, taxes, total.
// The page language follows the market (cesko → cs-CZ; slovensko → its own
// language, sk or en depending on the store's languages); summary labels are
// matched in Czech, Slovak and English.

export const SUBTOTAL = /^(Mezisoučet|Medzisúčet|Subtotal)/iu;
export const SHIPPING = /^(Expedice|Doprava|Expedícia|Doručenie|Shipping)/iu;
export const TOTAL = /^(Celkem|Celkom|Spolu|Total)$/iu;
export const TAX = /(Daně|Daň|Dane|DPH|Taxes|Tax)/iu;
/** A line or row the checkout prints as free instead of "0,00 Kč". */
export const FREE = /^(Zdarma|Zadarmo|Free|ZDARMA|ZADARMO|FREE)$/u;

/** "1 234,56 Kč" / "− 29,43 Kč" / "(-21,80 Kč)" / "CZK 819,77 Kč" / "8,60 €" → signed minor units (2-digit currency); null when there is no amount. */
export function minorUnits(text: string): number | null {
  const match = /([\u2212-])?\s*(\d[\d\s\u00a0\u202f.]*[.,]\d{2})(?!\d)/u.exec(text);
  if (!match) return null;
  const digits = match[2]!.replace(/[^\d]/gu, "");
  return Number(digits) * (match[1] ? -1 : 1);
}

export interface SummaryRow {
  label: string;
  value: string;
  amount: number | null;
}

export interface CheckoutLine {
  title: string;
  /** One per discount allocation on the line, as the checkout lists it. */
  allocations: { title: string; amount: number | null }[];
  originalPrice: number | null;
  finalPrice: number | null;
}

/** The aside that holds the price summary (a collapsed mobile header aside comes first). */
function summaryAside(page: Page): Locator {
  return page.locator("aside", { has: page.locator('[role="table"][aria-labelledby^="MoneyLine-Heading"]') }).last();
}

/** Rows of the price summary table. */
export async function priceSummary(page: Page): Promise<SummaryRow[]> {
  const table = summaryAside(page).locator('[role="table"][aria-labelledby^="MoneyLine-Heading"]');
  await expect(table).toBeVisible({ timeout: 60_000 });
  const rows = await table.locator('[role="row"]').evaluateAll((elements) =>
    elements.map((row) => {
      const header = row.querySelector('[role="rowheader"]');
      const cell = row.querySelector('[role="cell"]');
      // The cell repeats its value in an aria-hidden animation copy: read the visible copy (the last text node holder).
      const visible = cell ? [...cell.querySelectorAll("span,strong")].filter((el) => !el.closest('[aria-hidden="true"]')) : [];
      const value = visible.length ? (visible[visible.length - 1]!.textContent ?? "") : (cell?.textContent ?? "");
      return { label: (header?.textContent ?? "").replace(/\s+/gu, " ").trim(), value: value.replace(/\s+/gu, " ").trim() };
    }),
  );
  return rows.filter((row) => row.label !== "").map((row) => ({ ...row, amount: minorUnits(row.value) }));
}

/** Amount of the first summary row whose label matches (a string matches a row containing it, e.g. a discount code). */
export function rowAmount(rows: readonly SummaryRow[], label: RegExp | string): number | null {
  const row = rows.find((r) => (typeof label === "string" ? r.label.toUpperCase().includes(label.toUpperCase()) : label.test(r.label)));
  return row?.amount ?? null;
}

/** The line items table, one entry per cart line. */
export async function checkoutLines(page: Page): Promise<CheckoutLine[]> {
  const table = summaryAside(page).locator('[role="table"][aria-labelledby^="ResourceList"]');
  await expect(table).toBeVisible({ timeout: 60_000 });
  const raw = await table.locator('[role="rowgroup"] [role="row"]').evaluateAll((rows) =>
    rows
      .filter((row) => row.querySelector('[role="cell"]'))
      .map((row) => {
        const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/gu, " ").trim();
        // Each allocation: <p><span dir="auto">TITLE</span> (-21,80 Kč)</p>.
        const allocations = [...row.querySelectorAll('span[dir="auto"]')]
          .map((span) => ({ title: text(span), amountText: text(span.parentElement).slice(text(span).length).trim() }))
          .filter((a) => a.amountText.startsWith("("));
        // Cells: image, description (title + allocations), quantity, price (<s> original, <p> reduced) — the price is the last one.
        const cells = [...row.querySelectorAll('[role="cell"]')];
        const priceCell = cells[cells.length - 1] ?? null;
        const titleEl = cells.flatMap((cell) => (cell === priceCell ? [] : [...cell.querySelectorAll("p")])).find((p) => !p.querySelector('span[dir="auto"]')) ?? null;
        const priceTexts = priceCell ? [...priceCell.querySelectorAll("s, p")].map((el) => ({ tag: el.tagName, text: text(el) })) : [];
        // A line without a discount has no <s>/<p> pair: its price is the cell's only text.
        const priceCellText = priceCell ? text(priceCell) : "";
        return { title: text(titleEl), allocations, priceTexts, priceCellText };
      }),
  );
  return raw.map((line) => ({
    title: line.title,
    allocations: line.allocations.map((a) => ({ title: a.title, amount: minorUnits(a.amountText) })),
    originalPrice: minorUnits(line.priceTexts.find((p) => p.tag === "S")?.text ?? ""),
    finalPrice: priceOrFree(
      [...line.priceTexts].reverse().find((p) => p.tag === "P")?.text ?? (line.priceTexts.length === 0 ? line.priceCellText : ""),
    ),
  }));
}

/** minorUnits, with the checkout's "Zdarma"/"Free" read as 0. */
function priceOrFree(text: string): number | null {
  return minorUnits(text) ?? (FREE.test(text.trim()) ? 0 : null);
}

/** The allocation of `discountTitle` on the first line that has it (the checkout upper-cases discount titles). */
export function lineAllocation(lines: readonly CheckoutLine[], discountTitle: string): number | null {
  for (const line of lines) {
    const hit = line.allocations.find((a) => a.title.toUpperCase() === discountTitle.toUpperCase());
    if (hit) return hit.amount;
  }
  return null;
}

/**
 * Go to the storefront's /checkout (it redirects to /checkouts/cn/<token>) and wait for the form.
 * The hosted checkout sometimes never renders on the first load (MVP 3 final E2E: Horizon, no #email
 * after 90 s, the retry rendered in 31 s). Each attempt waits 40 s; a stalled one is logged (path +
 * title only, nothing secret) and the navigation repeats — the same cart, at most 3 loads.
 */
export async function openCheckout(page: Page, url = "/checkout"): Promise<void> {
  const email = page.locator("#email");
  for (let attempt = 1; ; attempt += 1) {
    const target = attempt > 1 && new URL(page.url()).pathname.startsWith("/checkouts/") ? page.url() : url;
    await page.goto(target, { waitUntil: "domcontentloaded" });
    const shown = await email.waitFor({ state: "visible", timeout: 40_000 }).then(
      () => true,
      () => false,
    );
    if (shown) break;
    console.log(`[openCheckout] attempt ${attempt}: no checkout form at ${new URL(page.url()).pathname} ("${await page.title().catch(() => "")}")`);
    if (attempt >= 3) {
      await expect(email, "the checkout form after 3 loads").toBeVisible({ timeout: 1_000 });
    }
  }
  expect(new URL(page.url()).pathname).toMatch(/^\/checkouts\//u);
}

/** Enter a discount code in the checkout's own discount field, as a buyer would; waits for its summary row. */
export async function applyCodeInCheckout(page: Page, code: string): Promise<void> {
  await page.locator('input[name="reductions"]').first().fill(code);
  await page.locator('form:has(input[name="reductions"]) button[type="submit"]').first().click();
  await expect.poll(async () => rowAmount(await priceSummary(page), code), { timeout: 60_000 }).not.toBeNull();
}

export interface ShippingAddress {
  countryCode: "CZ" | "SK";
  address1: string;
  postalCode: string;
  city: string;
}

/** Market cesko. */
export const CZECH_ADDRESS: ShippingAddress = { countryCode: "CZ", address1: "Václavské náměstí 1", postalCode: "110 00", city: "Praha" };
/** Market slovensko. */
export const SLOVAK_ADDRESS: ShippingAddress = { countryCode: "SK", address1: "Hlavné námestie 1", postalCode: "811 01", city: "Bratislava" };

/** Contact + a Czech shipping address (market cesko), then the first shipping rate. */
export async function fillCzechShippingAddress(page: Page, email = "won-e2e+mvp1@example.com"): Promise<void> {
  await fillShippingAddress(page, CZECH_ADDRESS, email);
}

/** Contact + a shipping address in `address.countryCode`, then the first shipping rate. */
export async function fillShippingAddress(page: Page, address: ShippingAddress, email: string): Promise<void> {
  await page.locator("#email").fill(email);
  await page.locator('select[name="countryCode"]').selectOption(address.countryCode);
  await page.locator('input[name="firstName"]:visible').first().fill("Won");
  await page.locator('input[name="lastName"]:visible').first().fill("Tester");
  await page.locator('input[name="address1"]:visible').first().fill(address.address1);
  await page.locator('input[name="postalCode"]:visible').first().fill(address.postalCode);
  await page.locator('input[name="city"]:visible').first().fill(address.city);
  await page.locator('input[name="city"]:visible').first().press("Tab");
  // Several rates → radios, pick the first; a single rate is preselected. Either way the summary gets a shipping amount.
  const radios = page.locator('#shippingMethod ~ * input[type="radio"], input[type="radio"][name^="shipping"]');
  await expect.poll(async () => (await radios.count()) > 0 || rowAmount(await priceSummary(page), SHIPPING) !== null, { timeout: 60_000 }).toBe(true);
  if ((await radios.count()) > 0) await radios.first().check();
  await expect.poll(async () => rowAmount(await priceSummary(page), SHIPPING), { timeout: 60_000 }).not.toBeNull();
}

async function fillCardField(page: Page, frame: string, name: string, value: string): Promise<void> {
  const input = page.frameLocator(`iframe[name^="card-fields-${frame}"]`).locator(`input[name="${name}"]`);
  await input.click();
  await input.pressSequentially(value, { delay: 50 });
}

/** Bogus gateway: card "1" (approved), any future expiry, CVV 111; waits for the thank-you page. */
export async function payWithBogusCard(page: Page): Promise<void> {
  await fillCardField(page, "number", "number", "1");
  await fillCardField(page, "expiry", "expiry", "1230");
  await fillCardField(page, "verification_value", "verification_value", "111");
  await fillCardField(page, "name", "name", "Bogus Gateway");
  await page.locator("#checkout-pay-button").click();
  await page.waitForURL(/thank[-_]you/u, { timeout: 150_000 });
}

/**
 * The thank-you page fades in over the payment form (a screenshot right after the
 * URL change shows both, gate-live-report.md). Wait until the form is gone, then
 * read what the card was charged from the order details ("•••• 1 · 839,30 Kč CZK").
 * Every spec reads the thank-you page and takes its screenshots only after this.
 */
export async function settledThankYou(page: Page): Promise<{ charged: number | null; payFormGone: boolean }> {
  const card = page.getByText(/\u2022+\s*1\s*\u00b7/u).first();
  await expect(card, "the order details show the charged card").toBeVisible({ timeout: 60_000 });
  const payFormGone = await expect(page.locator("#checkout-pay-button"))
    .toHaveCount(0, { timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1_500);
  const text = (await card.textContent()) ?? "";
  return { charged: minorUnits(text.slice(text.indexOf("\u00b7") + 1)), payFormGone };
}

/** On a phone the order summary is collapsed: open it (best effort) so a screenshot shows the discount lines. */
export async function expandMobileSummary(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: /Shrnutí objednávky|Súhrn objednávky|order summary/iu }).first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(1_000);
  }
}
