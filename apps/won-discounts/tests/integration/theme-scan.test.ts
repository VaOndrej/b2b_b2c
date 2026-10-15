import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { briefFileFor, codeEditorUrl, placeOfFile, tagPresence, unknownTags, type ThemeScanView } from "../../app/components/model/theme-scan.ts";
import {
  MAX_BODY_QUERIES,
  drawerOf,
  acceptsAppBlocks,
  blockFitsOf,
  clearThemeScanMemory,
  factsOf,
  readThemeScan,
  scanTheme,
  tagsIn,
  themeTagsOfScan,
} from "../../app/lib/integration/theme-scan.server.ts";
import { clearReadCache } from "../../app/lib/integration/themes.server.ts";
import { loadShopSyncFacts } from "../../app/lib/sync/sync-state.server.ts";
import type { AdminGraphQLResult } from "../../app/lib/admin-client.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";

// Umístění na webu (balík E1): the theme read. Tags `<won-discounts show="…">` in Liquid and in JSON templates (a
// "Custom Liquid" section), never in comments; the schemas that take app blocks (Horizon's product card does, Dawn's
// card is a snippet); the live theme's tags into ShopSyncState.themeTags. Schema excerpts are the real Horizon / Dawn
// files' (b2b_b2c_themes, 14 Oct 2026).

const HORIZON_CARD = `<product-card>{% content_for 'blocks' %}</product-card>
{% schema %}
{ "name": "t:names.product_card", "blocks": [{ "type": "@theme" }, { "type": "@app" }, { "type": "_product-card-gallery" }] }
{% endschema %}`;

const DAWN_MAIN_PRODUCT = `{%- for block in section.blocks -%}{%- case block.type -%}{%- when '@app' -%}{% render block %}{%- endcase -%}{%- endfor -%}
{% schema %}
{ "name": "t:sections.main-product.name", "blocks": [{ "type": "@app" }, { "type": "text", "name": "Text" }] }
{% endschema %}`;

const DAWN_CARD = `{% comment %}
  Renders a product card. <won-discounts show="card-tier"></won-discounts> in a comment is not a tag.
{% endcomment %}
<div class="card-wrapper">
  <won-discounts show="card-tier" product="{{ card_product.handle }}"></won-discounts>
  {%- # <won-discounts show="milestones"> inline comment -%}
  <!-- <won-discounts show="campaign"></won-discounts> -->
</div>`;

test("tags: attributes, line numbers, Liquid in a value; comments, doc blocks and schemas hold none", () => {
  assert.deepEqual(tagsIn("snippets/card-product.liquid", DAWN_CARD), [{ show: "card-tier", product: "{{ card_product.handle }}", file: "snippets/card-product.liquid", line: 5 }]);
  assert.deepEqual(tagsIn("sections/x.liquid", `{% doc %}<won-discounts show="cart">{% enddoc %}\n<WON-DISCOUNTS size='full' show=milestones align="center">`), [
    { show: "milestones", size: "full", align: "center", file: "sections/x.liquid", line: 2 },
  ]);
  assert.deepEqual(tagsIn("snippets/y.liquid", "<won-discountsx show='cart'><won-discounts>"), [{ show: "", file: "snippets/y.liquid", line: 1 }], "only the element itself; no show = an empty show");
});

test("tags in a JSON template: a Custom Liquid section's code, escaped as JSON escapes it", () => {
  const template = `/* generated */\n{\n  "sections": {\n    "custom": {\n      "type": "custom-liquid",\n      "settings": { "custom_liquid": "\\u003cwon-discounts show=\\"milestones\\" size=\\"bar\\"\\u003e\\u003c\\/won-discounts\\u003e" }\n    }\n  }\n}`;
  assert.deepEqual(tagsIn("templates/index.json", template), [{ show: "milestones", size: "bar", file: "templates/index.json", line: 6 }]);
  const plain = JSON.stringify({ sections: { a: { type: "custom-liquid", settings: { custom_liquid: '<won-discounts show="campaign"></won-discounts>' } } } });
  assert.deepEqual(tagsIn("sections/header-group.json", plain).map((t) => t.show), ["campaign"]);
  assert.deepEqual(factsOf("templates/product.json", JSON.stringify({ sections: { main: { type: "main-product" }, r: { type: "related-products" } } })).sections, ["main-product", "related-products"]);
});

test("schemas: @app among a section's / block's blocks (Horizon card, Dawn product); a `when '@app'` in the code alone is not it", () => {
  assert.equal(acceptsAppBlocks(HORIZON_CARD), true);
  assert.equal(acceptsAppBlocks(DAWN_MAIN_PRODUCT), true);
  assert.equal(acceptsAppBlocks(`{%- when '@app' -%}{% schema %}{"blocks":[{"type":"text"}]}{% endschema %}`), false);
  assert.equal(acceptsAppBlocks(DAWN_CARD), false, "no schema");
});

test("where a block fits: JSON templates, the header group, a product card that is a theme block with @app; never the drawer", () => {
  const facts = (entries: [string, string][]) => new Map(entries.map(([name, content]) => [name, factsOf(name, content)]));
  const horizon = blockFitsOf(facts([["templates/product.json", "{}"], ["templates/index.json", "{}"], ["templates/cart.json", "{}"], ["sections/header-group.json", "{}"], ["blocks/_product-card.liquid", HORIZON_CARD], ["snippets/cart-drawer.liquid", ""]]));
  assert.deepEqual(horizon, { product: true, home: true, cart: true, header: true, card: true, drawer: false });
  const dawn = blockFitsOf(facts([["templates/product.json", "{}"], ["templates/index.json", "{}"], ["templates/cart.json", "{}"], ["sections/header-group.json", "{}"], ["snippets/card-product.liquid", DAWN_CARD]]));
  assert.equal(dawn.card, false, "Dawn's card is a snippet");
  const vintage = blockFitsOf(facts([["templates/product.liquid", ""], ["templates/index.liquid", ""], ["sections/header.liquid", ""]]));
  assert.deepEqual(vintage, { product: false, home: false, cart: false, header: false, card: false, drawer: false });
});

test("the cart drawer the cart script places by itself: Horizon's and Dawn's, with both spots; anything else (or another file) is not", () => {
  const horizon = '<cart-drawer-component><scroll-hint class="cart-drawer__content"><div class="cart-drawer__summary"></div></scroll-hint></cart-drawer-component>';
  const dawnDrawer = '<div id="CartDrawer" class="cart-drawer"><cart-drawer-items><form></form></cart-drawer-items><div class="drawer__footer"></div></div>';
  assert.equal(drawerOf("snippets/cart-drawer.liquid", horizon), "horizon");
  assert.equal(drawerOf("snippets/cart-drawer.liquid", dawnDrawer), "dawn");
  assert.equal(drawerOf("snippets/cart-drawer.liquid", horizon.replace("cart-drawer__summary", "my-summary")), undefined, "a changed drawer is not guessed at");
  assert.equal(drawerOf("snippets/other.liquid", horizon), undefined);
  assert.equal(factsOf("snippets/cart-drawer.liquid", dawnDrawer).drawer, "dawn");
});

test("tg from the live theme's tags: sizes each once in the block's order (unknown → compact), campaign, card; nothing → null", () => {
  const tag = (show: string, size?: string) => ({ show, ...(size ? { size } : {}), file: "f", line: 1 });
  assert.deepEqual(themeTagsOfScan([tag("milestones", "full"), tag("milestones", "huge"), tag("milestones", "full"), tag("card-tier"), tag("campaign")]), { ms: ["compact", "full"], cp: 1, cd: 1 });
  assert.deepEqual(themeTagsOfScan([tag("milestones")]), { ms: ["compact"] });
  assert.equal(themeTagsOfScan([tag("cart"), tag("typo")]), null, "a cart tag needs nothing in tg");
  assert.deepEqual(themeTagsOfScan([tag("tiers"), tag("outlet")]), { ti: 1, ob: 1 }, "balík D");
});

test("model: the place a file stands for, the brief's file, the code editor link, presence live / in a copy, unknown shows", () => {
  assert.equal(placeOfFile("snippets/cart-drawer.liquid"), "drawer");
  assert.equal(placeOfFile("snippets/card-product.liquid"), "card");
  assert.equal(placeOfFile("blocks/_product-card.liquid"), "card");
  assert.equal(placeOfFile("sections/main-cart-footer.liquid"), "cart");
  assert.equal(placeOfFile("sections/header-group.json"), "header");
  assert.equal(placeOfFile("templates/index.json"), "home");
  assert.equal(placeOfFile("sections/main-product.liquid"), "product");
  assert.equal(placeOfFile("snippets/price.liquid"), null);
  assert.equal(briefFileFor("drawer", ["snippets/cart-drawer.liquid", "sections/main-cart-items.liquid"]), "snippets/cart-drawer.liquid");
  assert.equal(briefFileFor("card", ["snippets/card-product.liquid"]), "snippets/card-product.liquid");
  assert.equal(briefFileFor("card", ["snippets/product-card.liquid", "blocks/_product-card.liquid"]), "snippets/product-card.liquid");
  assert.equal(briefFileFor("card", ["snippets/price.liquid"]), null);
  assert.equal(codeEditorUrl("x.myshopify.com", "123", "snippets/cart-drawer.liquid"), "https://x.myshopify.com/admin/themes/123?key=snippets%2Fcart-drawer.liquid");
  assert.equal(codeEditorUrl("evil.com", "123", null), null);
  const scan: ThemeScanView = {
    state: "ok",
    live: { id: "1", name: "Dawn", live: true, complete: true, tags: [{ show: "cart", file: "snippets/cart-drawer.liquid", line: 3 }, { show: "carts", file: "x", line: 1 }], fits: { product: true, home: true, cart: true, header: true, card: false, drawer: false }, files: [], blocks: {}, drawer: null },
    copies: [{ id: "2", name: "Dawn – kopie", live: false, complete: true, tags: [{ show: "card-tier", file: "snippets/card-product.liquid", line: 9 }] }],
  };
  assert.equal(tagPresence(scan, "cart", "drawer").in, "live");
  assert.equal(tagPresence(scan, "cart", "cart").in, "none");
  assert.deepEqual(tagPresence(scan, "card-tier"), { in: "copy", theme: "Dawn – kopie", tags: [{ show: "card-tier", file: "snippets/card-product.liquid", line: 9 }] });
  assert.deepEqual(unknownTags(scan).map((t) => t.show), ["carts"]);
});

// --- Reading through Admin GraphQL (a fake theme API) --------------------------------------------------------------

interface FakeFile {
  filename: string;
  checksum: string;
  content: string;
}

/** The theme API as the scan uses it: a file list by patterns, bodies by name, answers trimmed to `perPage`. */
class FakeThemes {
  themes: { id: string; name: string; role: string; updatedAt: string; files: FakeFile[] }[] = [];
  ops: string[] = [];
  perPage = 50;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scan names the shape it reads
  async graphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<AdminGraphQLResult<T>> {
    return (await this.answer(query, variables)) as AdminGraphQLResult<T>;
  }
  private async answer(query: string, variables: Record<string, unknown>): Promise<{ data: unknown }> {
    const op = /(query)\s+(\w+)/.exec(query)?.[2] ?? "?";
    this.ops.push(op);
    if (op === "WonThemeScanThemes") return { data: { themes: { nodes: this.themes.map(({ id, name, role, updatedAt }) => ({ id, name, role, updatedAt })) } } };
    const theme = this.themes.find((t) => t.id === variables.id);
    if (!theme) return { data: { theme: null } };
    const start = typeof variables.after === "string" ? Number(variables.after) : 0;
    if (op === "WonThemeScanIndex") {
      const page = theme.files.slice(start, start + 2500);
      return { data: { theme: { files: { nodes: page.map((f) => ({ filename: f.filename, checksumMd5: f.checksum, size: f.content.length })), pageInfo: { hasNextPage: start + 2500 < theme.files.length, endCursor: String(start + 2500) } } } } };
    }
    const wanted = theme.files.filter((f) => (variables.filenames as string[]).includes(f.filename));
    const page = wanted.slice(start, start + this.perPage);
    const more = start + this.perPage < wanted.length;
    return { data: { theme: { files: { nodes: page.map((f) => ({ filename: f.filename, checksumMd5: f.checksum, body: { content: f.content } })), pageInfo: { hasNextPage: more, endCursor: String(start + this.perPage) } } } } };
  }
  count(op: string): number {
    return this.ops.filter((o) => o === op).length;
  }
}

function dawnFiles(extra: FakeFile[] = []): FakeFile[] {
  return [
    { filename: "templates/product.json", checksum: "p", content: JSON.stringify({ sections: { main: { type: "main-product" } } }) },
    { filename: "templates/index.json", checksum: "i", content: JSON.stringify({ sections: { c: { type: "custom-liquid", settings: { custom_liquid: '<won-discounts show="milestones" size="full"></won-discounts>' } } } }) },
    { filename: "templates/cart.json", checksum: "c", content: "{}" },
    { filename: "sections/header-group.json", checksum: "h", content: "{}" },
    { filename: "sections/main-product.liquid", checksum: "mp", content: DAWN_MAIN_PRODUCT },
    { filename: "snippets/card-product.liquid", checksum: "cp", content: DAWN_CARD },
    ...extra,
  ];
}

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-theme-scan");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `scan-${seq}.myshopify.com`;
  clearThemeScanMemory();
  clearReadCache();
});

test("a theme: the file list, then bodies 50 names a query, paged when Shopify trims; a file seen by its checksum is not read again", async () => {
  const api = new FakeThemes();
  api.perPage = 4;
  const many = Array.from({ length: 60 }, (_, i) => ({ filename: `snippets/s${i}.liquid`, checksum: `s${i}`, content: "x" }));
  api.themes = [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", updatedAt: "2026-10-01", files: dawnFiles(many) }];
  const first = await scanTheme(api, "gid://shopify/OnlineStoreTheme/1");
  assert.equal(first.complete, true);
  assert.equal(first.files.size, 66);
  // 66 names → 2 name groups (50 + 16), 4 files an answer → 13 + 4 body queries.
  assert.equal(api.count("WonThemeScanBodies"), 17);
  api.ops = [];
  const again = await scanTheme(api, "gid://shopify/OnlineStoreTheme/1");
  assert.deepEqual(api.ops, ["WonThemeScanIndex"], "nothing new: only the file list");
  assert.equal(again.files.get("snippets/card-product.liquid")?.tags[0]?.show, "card-tier");
});

test("a theme over the body-query bound is incomplete (nothing is concluded from a tag it did not see)", async () => {
  const api = new FakeThemes();
  api.perPage = 1;
  const many = Array.from({ length: MAX_BODY_QUERIES + 5 }, (_, i) => ({ filename: `snippets/s${i}.liquid`, checksum: `s${i}`, content: "x" }));
  api.themes = [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", updatedAt: "2026-10-01", files: many }];
  const scanned = await scanTheme(api, "gid://shopify/OnlineStoreTheme/1");
  assert.equal(scanned.complete, false);
  assert.equal(api.count("WonThemeScanBodies"), MAX_BODY_QUERIES);
});

test("readThemeScan: the live theme and the 3 newest copies; the live tags into ShopSyncState.themeTags (a change says so once); a copy of the live theme costs its file list", async () => {
  const api = new FakeThemes();
  const copy = (id: number, updatedAt: string, files: FakeFile[]) => ({ id: `gid://shopify/OnlineStoreTheme/${id}`, name: `Kopie ${id}`, role: "UNPUBLISHED", updatedAt, files });
  api.themes = [
    { id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", updatedAt: "2026-10-01", files: dawnFiles() },
    copy(2, "2026-10-02", dawnFiles()),
    copy(3, "2026-10-05", dawnFiles([{ filename: "snippets/cart-drawer.liquid", checksum: "dr", content: '<won-discounts show="cart"></won-discounts>' }])),
    copy(4, "2026-09-01", dawnFiles()),
    copy(5, "2026-10-03", dawnFiles()),
  ];
  const ctx = { shop, client: api, db: db.prisma };
  const read = await readThemeScan(ctx, { scopes: "read_products,read_themes" });
  assert.equal(read.tagsChanged, true);
  assert.equal(read.scan.state, "ok");
  if (read.scan.state !== "ok") return;
  assert.equal(read.scan.live.name, "Dawn");
  assert.equal(read.scan.live.id, "1");
  assert.deepEqual(read.scan.live.fits, { product: true, home: true, cart: true, header: true, card: false, drawer: false });
  assert.deepEqual(read.scan.copies.map((c) => c.id), ["3", "5", "2"], "the 3 newest copies");
  assert.equal(tagPresence(read.scan, "cart").in, "copy", "the drawer tag is only in a copy");
  // Bodies were read once (the live theme); every copy shares the checksums but the drawer file.
  assert.equal(api.count("WonThemeScanBodies"), 2);
  assert.deepEqual((await loadShopSyncFacts(db.prisma, shop)).themeTags, { ms: ["full"], cd: 1 });

  const again = await readThemeScan(ctx, { scopes: "read_themes", fresh: true });
  assert.equal(again.tagsChanged, false, "the same tags: no change");
  assert.deepEqual(await readThemeScan(ctx, { scopes: "read_products" }), { scan: { state: "no_scope" }, tagsChanged: false });
});

test("readThemeScan: an unreadable live theme is unknown and records nothing; an auth failure is passed on", async () => {
  const api = new FakeThemes();
  api.themes = [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn", role: "MAIN", updatedAt: "2026-10-01", files: [] }];
  const read = await readThemeScan({ shop, client: api, db: db.prisma }, { scopes: "read_themes" });
  assert.deepEqual(read, { scan: { state: "unknown" }, tagsChanged: false });
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).themeTagsAt, null);
  const auth = {
    graphql: async <T,>(): Promise<AdminGraphQLResult<T>> => {
      throw new Response(null, { status: 401 });
    },
  };
  await assert.rejects(readThemeScan({ shop: `${shop}x`, client: auth, db: db.prisma }, { scopes: "read_themes" }), (e: unknown) => e instanceof Response);
});
