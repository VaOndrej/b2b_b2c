import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { DEFAULT_CONFIG, readStoredConfig } from "@won/core/discounts/config";

import { PIECES, otherTags, pieceRows, type PieceKey, type PieceRow, type PlacementContent } from "../../app/components/model/placements.ts";
import { BRIEF_MAX_CONTENT, composeBrief, tagLine } from "../../app/components/model/theme-brief.ts";
import type { ScannedTag, ThemeScanView } from "../../app/components/model/theme-scan.ts";
import type { AdminGraphQLResult } from "../../app/lib/admin-client.server.ts";
import { placementContentOf, placementsAction } from "../../app/lib/integration/placements.server.ts";
import { clearThemeScanMemory } from "../../app/lib/integration/theme-scan.server.ts";
import { clearReadCache } from "../../app/lib/integration/themes.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";

// Umístění na webu (balík E2–E5): the rows of the page — the way in (a block where the theme takes one, else the
// tag), the state (tag in the live theme › block › tag only in a copy › missing / unknown) and its cause (Won off,
// nothing to show) — the brief for an AI from theme-tags.ts with the theme's own file, and the page's `brief` action.

const ALL: PlacementContent = { tiers: true, rewards: true, campaigns: true, outlet: true, cards: true };
const tag = (show: string, file: string, line = 1): ScannedTag => ({ show, file, line });

function dawn(tags: ScannedTag[], copies: { name: string; tags: ScannedTag[] }[] = [], drawer: "horizon" | "dawn" | null = null): ThemeScanView {
  return {
    state: "ok",
    live: { id: "1", name: "Dawn", live: true, complete: true, tags, fits: { product: true, home: true, cart: true, header: true, card: false, drawer: false }, files: ["snippets/cart-drawer.liquid", "snippets/card-product.liquid"], blocks: {}, drawer },
    copies: copies.map((c, i) => ({ id: String(10 + i), name: c.name, live: false, complete: true, tags: c.tags })),
  };
}

const row = (rows: PieceRow[], key: PieceKey) => rows.find((r) => r.key === key)!;

test("the way in: the drawer is always the tag; the card the tag where it takes no block (Dawn), the block where it does; unknown theme = the block", () => {
  const rows = pieceRows({ scan: dawn([]), blocks: {}, embed: "on", content: ALL });
  assert.equal(row(rows, "msDrawer").way, "tag");
  assert.equal(row(rows, "cardTier").way, "tag");
  assert.equal(row(rows, "msProduct").way, "block");
  assert.equal(row(rows, "tiersTable").way, "block", "the product page takes a block: the tag is the merchant's choice");
  const horizon = dawn([]);
  if (horizon.state === "ok") horizon.live.fits.card = true;
  assert.equal(row(pieceRows({ scan: horizon, blocks: {}, embed: "on", content: ALL }), "cardTier").way, "block");
  const unknown = pieceRows({ scan: { state: "unknown" }, blocks: {}, embed: "on", content: ALL });
  assert.equal(row(unknown, "cardTier").way, "block");
  assert.equal(row(unknown, "msDrawer").way, "tag");
  assert.equal(row(unknown, "msDrawer").state.at, "unknown", "an unread theme never says missing");
});

test("the state: a tag in the live theme's file for the place wins; a block; a tag only in a copy; missing; a tag in another file is a place of its own", () => {
  const scan = dawn([tag("cart", "snippets/cart-drawer.liquid", 132), tag("milestones", "sections/footer.liquid", 12), tag("carts", "x.liquid")], [{ name: "Kopie", tags: [tag("card-tier", "snippets/card-product.liquid", 9)] }]);
  const rows = pieceRows({ scan, blocks: { msCart: true, msProduct: false }, embed: "on", content: ALL });
  assert.deepEqual(row(rows, "msDrawer").state, { at: "tag_live", tags: [tag("cart", "snippets/cart-drawer.liquid", 132)] });
  assert.equal(row(rows, "msCart").state.at, "in_theme");
  assert.deepEqual(row(rows, "cardTier").state, { at: "tag_copy", theme: "Kopie", tags: [tag("card-tier", "snippets/card-product.liquid", 9)] });
  assert.equal(row(rows, "msProduct").state.at, "missing");
  assert.equal(row(rows, "msHeader").state.at, "unknown", "a block not read is not verified");
  assert.deepEqual(otherTags(scan).map((t) => t.show), ["milestones", "carts"]);
  assert.equal(PIECES.length, rows.length);
  // Balík D: the table and the badge in the product section's code count for their rows.
  const product = pieceRows({ scan: dawn([tag("tiers", "sections/main-product.liquid", 40), tag("outlet", "sections/main-product.liquid", 41)]), blocks: { tiersTable: false }, embed: "on", content: ALL });
  assert.equal(row(product, "tiersTable").state.at, "tag_live");
  assert.equal(row(product, "outletBadge").state.at, "tag_live");
  assert.equal(tagLine("tiers", "product", "sections/main-product.liquid"), '<won-discounts show="tiers"></won-discounts>');
});

test("the cause: a tag with Won off (or only in a draft) says so; a piece that is there with nothing to show says why", () => {
  const scan = dawn([tag("cart", "snippets/cart-drawer.liquid"), tag("card-tier", "snippets/card-product.liquid")]);
  const off = pieceRows({ scan, blocks: { msCart: true }, embed: "off", content: ALL });
  assert.deepEqual(row(off, "msDrawer").cause, { kind: "embed_off", draft: false });
  assert.equal(row(off, "msCart").cause, null, "a block needs no embed");
  assert.deepEqual(row(pieceRows({ scan, blocks: {}, embed: "draft_only", content: ALL }), "msDrawer").cause, { kind: "embed_off", draft: true });
  const empty = pieceRows({ scan, blocks: { msCart: true, cpHome: true, outletBadge: true }, embed: "on", content: { tiers: true, rewards: false, campaigns: false, outlet: false, cards: false } });
  assert.deepEqual(row(empty, "msDrawer").cause, { kind: "nothing", why: "noSteps" });
  assert.deepEqual(row(empty, "cpHome").cause, { kind: "nothing", why: "noCampaign" });
  assert.deepEqual(row(empty, "outletBadge").cause, { kind: "nothing", why: "noSale" });
  assert.deepEqual(row(empty, "cardTier").cause, { kind: "nothing", why: "cardsOff" });
  assert.equal(row(empty, "msProduct").cause, null, "nothing there: no cause");
});

test("zásuvka košíku (varianta 1 + AI): Horizon's / Dawn's drawer takes the panel by itself, where the Won embed says; off; a tag wins; Won off says so; another theme = the brief for AI", async () => {
  const auto = (drawerPosition: "summary" | "top" | "off" | undefined, tags: ScannedTag[] = [], embed: "on" | "off" = "on") =>
    row(pieceRows({ scan: dawn(tags, [], "dawn"), blocks: {}, embed, content: ALL, ...(drawerPosition ? { drawerPosition } : {}) }), "msDrawer");
  assert.deepEqual([auto("summary").way, auto("summary").state], ["auto", { at: "auto", theme: "dawn", position: "summary" }]);
  assert.deepEqual(auto("top").state, { at: "auto", theme: "dawn", position: "top" });
  assert.deepEqual(auto("off").state, { at: "missing", off: true });
  assert.equal(auto(undefined).state.at, "unknown", "the embed's settings not read");
  assert.equal(auto("summary", [tag("cart", "snippets/cart-drawer.liquid", 5)]).state.at, "tag_live", "the tag wins");
  assert.deepEqual(auto("summary", [], "off").cause, { kind: "embed_off", draft: false });
  const other = row(pieceRows({ scan: dawn([]), blocks: {}, embed: "on", content: ALL, drawerPosition: "summary" }), "msDrawer");
  assert.deepEqual([other.way, other.state.at], ["tag", "missing"]);
});

test("what a module has to show: the gated storefront config (no tiers, no steps, no campaign in a fresh shop)", () => {
  const fresh = readStoredConfig({ ...DEFAULT_CONFIG, schemaVersion: 1 });
  assert.deepEqual(placementContentOf(fresh, "pro", "Europe/Prague", new Date("2026-10-14T12:00:00Z")), { tiers: false, rewards: false, campaigns: false, outlet: false, cards: false });
  const withCampaign = readStoredConfig({ ...DEFAULT_CONFIG, schemaVersion: 1, campaigns: [{ id: "bf", name: "BF", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T00:00:00" }, overrides: [], killed: false }] });
  assert.equal(placementContentOf(withCampaign, "pro", "Europe/Prague", new Date("2026-10-14T12:00:00Z")).campaigns, true, "planned counts");
  assert.equal(placementContentOf(withCampaign, "pro", "Europe/Prague", new Date("2026-12-14T12:00:00Z")).campaigns, false, "over");
  assert.equal(placementContentOf(withCampaign, "free", "Europe/Prague", new Date("2026-10-14T12:00:00Z")).campaigns, false, "Free: no campaigns");
});

test("the brief: the line, the file, the rules from theme-tags.ts, the file's content; Dawn's card variable; a long file is cut and asks for lines", () => {
  const brief = composeBrief({ show: "cart", place: "drawer", themeName: "Dawn", file: "snippets/cart-drawer.liquid", content: "<div>{{ cart.total_price }}</div>" });
  assert.match(brief, /theme "Dawn"/);
  assert.match(brief, /<won-discounts show="cart"><\/won-discounts>/);
  assert.match(brief, /In the file `snippets\/cart-drawer\.liquid`, in the cart drawer/);
  assert.match(brief, /`size` \(`compact`, `full`\)/);
  assert.match(brief, /WHOLE changed file/);
  assert.match(brief, /```liquid\n<div>\{\{ cart\.total_price \}\}<\/div>\n```/);
  assert.equal(tagLine("card-tier", "card", "snippets/card-product.liquid"), '<won-discounts show="card-tier" product="{{ card_product.handle }}"></won-discounts>');
  assert.equal(tagLine("card-tier", "card", "snippets/product-card.liquid"), '<won-discounts show="card-tier" product="{{ product.handle }}"></won-discounts>');
  const noFile = composeBrief({ show: "milestones", place: "header", themeName: "X", file: null, content: null });
  assert.match(noFile, /tell me which file/);
  assert.match(noFile, /size="bar" align="center"/);
  assert.doesNotMatch(noFile, /The current file/);
  const long = composeBrief({ show: "campaign", place: "home", themeName: "X", file: "templates/index.liquid", content: "x".repeat(BRIEF_MAX_CONTENT + 10) });
  assert.match(long, /the first 120000 characters/);
  assert.match(long, /exact lines around the place/);
});

// --- The `brief` action over a fake theme API ------------------------------------------------------------------

class FakeThemes {
  calls: { op: string; variables: Record<string, unknown> }[] = [];
  files: Record<string, string> = { "snippets/cart-drawer.liquid": "<div class=\"drawer\">{{ cart.total_price | money }}</div>", "templates/product.json": "{}" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the code names the shape it reads
  async graphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<AdminGraphQLResult<T>> {
    const op = /query\s+(\w+)/.exec(query)?.[1] ?? "?";
    this.calls.push({ op, variables });
    const names = Object.keys(this.files);
    let data: unknown;
    if (op === "WonThemeScanThemes") data = { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/7", name: "Dawn", role: "MAIN", updatedAt: "2026-10-01" }] } };
    else if (op === "WonThemeScanIndex") data = { theme: { files: { nodes: names.map((filename) => ({ filename, checksumMd5: filename, size: 1 })), pageInfo: { hasNextPage: false, endCursor: null } } } };
    else {
      const wanted = names.filter((n) => (variables.filenames as string[]).includes(n));
      data = { theme: { files: { nodes: wanted.map((filename) => ({ filename, checksumMd5: filename, body: { content: this.files[filename] } })), pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    return { data } as AdminGraphQLResult<T>;
  }
}

let db: TestDatabase;
before(() => {
  db = createTestDatabase("int-placements");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  clearThemeScanMemory();
  clearReadCache();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

test("action brief: the live theme's drawer file, read now, in the brief; a bad piece is refused; no read_themes → no theme", async () => {
  const api = new FakeThemes();
  const ctx = { shop: "brief.myshopify.com", db: db.prisma, client: api, locale: "cs" as const, apiKey: "k", scopes: "read_themes" };
  const result = await placementsAction(ctx, form({ intent: "brief", piece: "msDrawer" }));
  assert.equal(result.ok && result.kind === "brief" && result.file, "snippets/cart-drawer.liquid");
  if (!result.ok || result.kind !== "brief") return;
  assert.equal(result.read, true);
  assert.match(result.brief, /<div class="drawer">\{\{ cart\.total_price \| money \}\}<\/div>/);
  assert.equal(api.calls.at(-1)!.op, "WonThemeScanBodies");
  assert.deepEqual(api.calls.at(-1)!.variables.filenames, ["snippets/cart-drawer.liquid"]);
  // Balík D: the table has a tag too; its brief is about the product page (no file of it in this fake theme).
  const table = await placementsAction(ctx, form({ intent: "brief", piece: "tiersTable" }));
  assert.equal(table.ok && table.kind === "brief" && /show="tiers"/.test(table.brief), true);
  assert.deepEqual(await placementsAction(ctx, form({ intent: "brief", piece: "nope" })), { ok: false, reason: "bad_request" });
  assert.deepEqual(await placementsAction(ctx, form({ intent: "other" })), { ok: false, reason: "bad_request" });
  clearReadCache();
  assert.deepEqual(await placementsAction({ ...ctx, scopes: "read_products" }, form({ intent: "brief", piece: "msDrawer" })), { ok: false, reason: "no_theme" });
});
