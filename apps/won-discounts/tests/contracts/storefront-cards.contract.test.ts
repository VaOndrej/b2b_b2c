import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// SPEC-DRIVEN contract for prices by quantity on product cards (MVP 7 BETA, plan M8, decision P6).
//   snippets/won-card-tier.liquid   decides what a card may say — the Liquid twin of core cardTier (its property
//                                   test against planCart is packages/core/tests/discounts/card-tier.test.ts);
//                                   every condition of the reference must be in the snippet;
//   blocks/card_tiers.liquid        the card block (Liquid only, no script);
//   the embed                       {handle: text} for a collection / search page + assets/won-discounts-cards.js,
//                                   which only places the text and never touches the cart (SF-1).

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = path.join(appRoot, "extensions/won-discounts-storefront");
const read = (relativePath: string) => readFile(path.join(extensionRoot, relativePath), "utf8");

test("the snippet holds every condition of core cardTier, in a fail-closed form", async () => {
  const liquid = await read("snippets/won-card-tier.liquid");
  for (const [what, pattern] of [
    ["cards on, config v1, at most 50 variants checked", /if cfg\.v == 1 and cfg\.cards == 1 and p\.variants\.size <= 50/],
    ["K1: tierRef, else the global set", /assign set_id = pmf\.tierRef\s+if set_id == nil\s+assign set_id = cfg\.tiers\.global/],
    ["the FIRST break only", /cfg\.tiers\.sets\[set_id\]\.breaks\.first/],
    ["a sale variant", /v_sale == true or v_sale == 2 or v_sale == 4 or v_sale == 6[\s\S]*if on_sale and cfg\.ow != 1\s+assign show = false/],
    ["a purchase cost under margin protection", /vmf\.variant != nil or vmf\.pdp != nil[\s\S]*if margin_on and costed\s+assign show = false/],
    ["a percent within the ceiling", /if b\.pct > 0 and b\.pct <= cap/],
    ["the ceiling of more than 4 refs = the lowest of all collections", /if pmf\.marginRefs\.size > 4\s+for pair in cfg\.margin\.col\s+assign cap = cap \| at_most: pair\.last/],
    ["an amount only without margin protection", /elsif margin_on == false\s+assign mk = cur \| append: '@' \| append: localization\.market\.handle\s+assign off = b\.off\[mk\] \| default: b\.off\[cur\]/],
    ["an amount at most the cheapest variant's price", /if off != nil and off > 0 and off <= p\.price_min/],
    ["a merchant text wins", /tx\['cards\.pct'\] \| default: t_pct[\s\S]*tx\['cards\.off'\] \| default: t_off/],
  ] as const) {
    assert.match(liquid, pattern, what);
  }
  assert.doesNotMatch(liquid, /<script|fetch\(/, "Liquid only");
});

test("the three locales have both card texts with their placeholders", async () => {
  for (const file of ["en.default.json", "cs.json", "sk.json"]) {
    const cards = (JSON.parse(await read(`locales/${file}`)) as { cards?: Record<string, string> }).cards;
    assert.ok(cards, file);
    assert.match(cards.pct ?? "", /\{min\}.*\{pct\}/, `${file} cards.pct`);
    assert.match(cards.off ?? "", /\{min\}.*\{amount\}/, `${file} cards.off`);
  }
});

test("the card block: Liquid only, the card's product (closest.product, else the page's), its own marker, no template limit", async () => {
  const liquid = await read("blocks/card_tiers.liquid");
  assert.match(liquid, /assign p = closest\.product \| default: product/);
  assert.match(liquid, /render 'won-card-tier', p: p, cfg: cfg, cur: cart\.currency\.iso_code, lang: lang/);
  assert.match(liquid, /data-won-discounts-card="\{\{ p\.handle \| escape \}\}"/);
  const schema = JSON.parse(liquid.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/)?.[1] ?? "{}");
  assert.equal(schema.target, "section");
  assert.equal(schema.javascript, undefined, "no script: the line arrives in the card's HTML");
  assert.equal(schema.enabled_on, undefined);
  assert.doesNotMatch(liquid.replace(/\{%\s*schema[\s\S]*$/, ""), /<script/);
});

test("the embed prints the page's {handle: text} (at most 50 products, products only, '</' escaped) and the custom look's ready stylesheet", async () => {
  const liquid = await read("blocks/won_discounts_embed.liquid");
  assert.match(liquid, /for won_p in won_list limit: 50/);
  assert.match(liquid, /if won_p\.variants != nil/, "a search result that is not a product is skipped");
  assert.match(liquid, /\{\{ won_p\.handle \| json \}\}:\{\{ won_label \| json \}\}/);
  assert.match(liquid, /id="won-discounts-cards">\{ \{\{- won_cards \| replace: '<\/', '<\\\/' -\}\} \}<\/script>/);
  assert.match(liquid, /\{%- if won_discounts_config_raw\.appearance\.css != blank -%\}\s*<style id="won-discounts-custom">\{\{ won_discounts_config_raw\.appearance\.css \}\}<\/style>/);
});

// --- won-discounts-cards.js in a vm with a minimal fake DOM -------------------------------------------------

interface FakeEl {
  tag: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  parentNode: FakeEl | null;
  className: string;
  textContent: string;
  card?: FakeEl | null;
  price?: FakeEl | null;
  marker?: boolean;
  nextSibling: FakeEl | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  closest(selector: string): FakeEl | null;
  querySelector(selector: string): FakeEl | null;
  querySelectorAll(selector: string): FakeEl[];
  appendChild(child: FakeEl): void;
  insertBefore(child: FakeEl, before: FakeEl | null): void;
}

function el(tag: string, attrs: Record<string, string> = {}): FakeEl {
  const node: FakeEl = {
    tag,
    attrs,
    children: [],
    parentNode: null,
    className: "",
    textContent: "",
    nextSibling: null,
    getAttribute: (name) => node.attrs[name] ?? null,
    setAttribute: (name, value) => void (node.attrs[name] = value),
    closest: () => node.card ?? null,
    querySelector: (selector) => {
      if (selector.includes("data-won-discounts-card")) {
        // Deep, like the real querySelector.
        const deep = (x: FakeEl): FakeEl | null => x.children.find((c) => "data-won-discounts-card" in c.attrs) ?? x.children.map(deep).find(Boolean) ?? null;
        return deep(node);
      }
      return node.price ?? null;
    },
    querySelectorAll: () => [],
    appendChild: (child) => {
      child.parentNode = node;
      node.children.push(child);
    },
    insertBefore: (child) => {
      child.parentNode = node;
      node.children.push(child);
    },
  };
  return node;
}

async function runCards(map: unknown, links: FakeEl[]) {
  const main = el("main");
  main.querySelectorAll = () => links;
  const data = el("script");
  data.textContent = typeof map === "string" ? map : JSON.stringify(map);
  const document = {
    getElementById: (id: string) => (id === "won-discounts-cards" ? data : null),
    querySelector: (selector: string) => (selector === "main" ? main : null),
    createElement: (tag: string) => el(tag),
    body: main,
  };
  vm.runInNewContext(await read("assets/won-discounts-cards.js"), { document, requestAnimationFrame: () => 0, MutationObserver: undefined });
}

function card(handle: string, opts: { price?: boolean; marked?: boolean; noCard?: boolean } = {}) {
  const c = el("li");
  const link = el("a", { href: `/products/${handle}?variant=1` });
  link.card = opts.noCard ? null : c;
  if (opts.price) {
    const priceWrap = el("div");
    c.appendChild(priceWrap);
    const price = el("span");
    priceWrap.appendChild(price);
    c.price = price;
  }
  if (opts.marked) c.appendChild(el("p", { "data-won-discounts-card": handle }));
  return { c, link };
}
const lines = (c: FakeEl): FakeEl[] => [c, ...c.children.flatMap((x) => lines(x))].filter((x) => "data-won-discounts-card" in x.attrs);

test("cards.js places each product's text once: beside the price when the card has one, at the card's end otherwise; a marked card and an unlisted product are left alone", async () => {
  const a = card("a", { price: true });
  const a2 = card("a"); // the same card linked twice (image + title)
  a2.link.card = a.c;
  const b = card("b");
  const blocked = card("c", { marked: true });
  const unlisted = card("zzz");
  const loose = card("a", { noCard: true });
  await runCards({ a: "Od 3 ks −10 %", b: "Od 2 ks −5 Kč za kus", c: "X" }, [a.link, a2.link, b.link, blocked.link, unlisted.link, loose.link]);
  assert.deepEqual(lines(a.c).map((l) => [l.className, l.textContent, l.attrs["data-won-discounts-card"], l.parentNode === a.c.children[0]]), [["won-card-tier", "Od 3 ks −10 %", "a", true]]);
  assert.deepEqual(lines(b.c).map((l) => [l.textContent, l.parentNode === b.c]), [["Od 2 ks −5 Kč za kus", true]]);
  assert.equal(lines(blocked.c).length, 1, "the card block's own line stays the only one");
  assert.equal(lines(unlisted.c).length, 0);
});

test("cards.js: text goes in as text (never markup), junk data and a missing data node do nothing", async () => {
  const a = card("a");
  await runCards({ a: "<img src=x onerror=alert(1)>" }, [a.link]);
  assert.equal(lines(a.c)[0]!.textContent, "<img src=x onerror=alert(1)>");
  const js = await read("assets/won-discounts-cards.js");
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(js, /\/cart\/|fetch\(|XMLHttpRequest|localStorage|cookie/, "reads its JSON, places text, nothing else (SF-1)");
  const junk = card("a");
  await assert.doesNotReject(runCards("{not json", [junk.link]));
  assert.equal(lines(junk.c).length, 0);
});

test("the AI briefs' class lists are exactly the classes of the extension's stylesheets, each element's starting with its own root; the variables are the ones a custom look sets", async () => {
  const { readdir } = await import("node:fs/promises");
  const { LOOK_CLASSES, FRAME_CLASSES, aiPrompt } = await import("../../app/lib/integration/looks.server.ts");
  const { CUSTOM_LOOK_VARS, isMilestoneElement, LOOK_ELEMENTS, LOOK_ROOT } = await import("@won/core/discounts/custom-look");
  const found = new Set<string>();
  for (const file of (await readdir(path.join(extensionRoot, "assets"))).filter((f) => f.endsWith(".css"))) {
    for (const m of (await read(`assets/${file}`)).matchAll(/\.(won-[a-z]+(?:(?:__|--)[a-z-]+|-[a-z]+)?)/g)) found.add(`.${m[1]}`);
  }
  // (the ladder has a look per place and the same classes in each: counted once)
  assert.deepEqual([...new Set([...LOOK_ELEMENTS.flatMap((element) => [...LOOK_CLASSES[element]]), ...FRAME_CLASSES])].sort(), [...found].sort());
  for (const element of LOOK_ELEMENTS) {
    // (the cart's root is three frames: the panel, its slot on the cart page, the top strip)
    // (a place of the ladder: its root ends at the ladder's own element, whose classes these are)
    const roots = element === "cart" ? [".won-cart", ".won-cart-slot", ".won-topbar"] : isMilestoneElement(element) ? [".won-ms"] : [LOOK_ROOT[element]];
    if (isMilestoneElement(element)) assert.ok(LOOK_ROOT[element].endsWith(".won-ms"), `${element}: ${LOOK_ROOT[element]}`);
    if (element === "cart") assert.equal(LOOK_ROOT.cart, `:is(${roots.join(",")})`);
    for (const cls of LOOK_CLASSES[element]) assert.ok(roots.some((root) => cls === root || cls.startsWith(`${root}__`) || cls.startsWith(`${root}--`)), `${cls} is the ${element}'s`);
    for (const variable of Object.values(CUSTOM_LOOK_VARS)) assert.ok(aiPrompt(element).includes(variable));
  }
  const css = await read("assets/won-discounts-tiers.css");
  for (const variable of Object.values(CUSTOM_LOOK_VARS)) assert.ok(css.includes(`var(${variable}`), `${variable} is read by the tiers stylesheet`);
  // The highlight colour is read by every element that has one to show.
  assert.ok((await read("assets/won-discounts.css")).includes("var(--won-tiers-accent") && (await read("assets/won-discounts-outlet.css")).includes("var(--won-tiers-accent"));
});

// Found by the live E2E (2026-10-04): Shopify wraps the output of an app snippet in HTML comments
// ("<!-- BEGIN app snippet: won-card-tier -->…<!-- END app snippet -->"), which the captured label carried onto the
// card as text. Both callers keep only the text between the comments.
// Found by the live E2E again (2026-10-08): Liquid's `split` drops trailing empty strings, so a snippet that said
// NOTHING left the opening comment itself as the label ("<!-- BEGIN app snippet: won-card-tier" on the card). The
// text is now marked before the split, so "nothing" stays nothing.
test("the card label is taken from between Shopify's app-snippet comments, in the block and in the embed — and a snippet that says nothing gives no label", async () => {
  const strip = /assign won_label = won_label \| split: '<!-- END' \| first \| append: '¦' \| split: '-->' \| last \| remove: '¦' \| strip/;
  assert.match(await read("blocks/card_tiers.liquid"), strip);
  assert.match(await read("blocks/won_discounts_embed.liquid"), strip);
  // The same filters as Liquid runs them: `split` without trailing empty strings, `first` / `last` of nothing = "".
  const split = (text: string, by: string) => {
    const parts = text.split(by);
    while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const label = (captured: string) => (split(`${split(captured, "<!-- END")[0] ?? ""}¦`, "-->").pop() ?? "").replace("¦", "").trim();
  assert.equal(label("<!-- BEGIN app snippet: won-card-tier -->Od 2 ks −10 %<!-- END app snippet -->"), "Od 2 ks −10 %");
  assert.equal(label("Od 2 ks −10 %"), "Od 2 ks −10 %");
  assert.equal(label("<!-- BEGIN app snippet: won-card-tier --><!-- END app snippet -->"), "");
  assert.equal(label(""), "");
  // What the filters did before: the opening comment as the card's text.
  const before = (captured: string) => (split(split(captured, "<!-- END")[0] ?? "", "-->").pop() ?? "").trim();
  assert.equal(before("<!-- BEGIN app snippet: won-card-tier --><!-- END app snippet -->"), "<!-- BEGIN app snippet: won-card-tier");
});
