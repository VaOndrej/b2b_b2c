// MVP 5 adversarial outlet sweep (plan docs/plans/2026-10-02-won-discounts-mvp5.md, "Rozpočet — výprodej"; stop rule
// fixed before the run: ONE pass per OUTLET_PRODUCTS ∈ {100, 50, 25}, every input of the MVP 3 cap-550 families × 3
// modes; no climbing). MVP 5 makes the sync write real outlet lists (`outlet: [variant GIDs]` in the product
// metafield): ONE list per product (it is a product metafield), holding only that product's own variant GIDs (contract
// O6) — so the filler GIDs are unique per product. Only the first OUTLET_PRODUCTS distinct products of the input carry
// a list (the shop's cap of running sales); each gets the longest list that still fits the MessagePack limit
// (OUTLET_LIST, else 20, 5, 1):
//   miss     none of the product's cart variants is in its list (every line scans it and stays discountable);
//   last     the product's cart variants END its list (found after the fillers; its lines are outlet);
//   every10  every 10th listed product as `last`, the others as `miss`.
// The input is trimmed back to the limit like rewards-variants.mjs (entered codes past 25, then the longest
// product ruleIds) so it stays a possible input.
//   OUTLET_PRODUCTS=100 node outlet-variants.mjs <outDir> <familyDir>...
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { messagePackBytes, inputLimit } = await import(`${EXT}/input-size.js`);
const [out, ...dirs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const PRODUCTS = Number(process.env.OUTLET_PRODUCTS ?? 100);
const LIST = Number(process.env.OUTLET_LIST ?? 100);
const MODES = ["miss", "last", "every10"];
const SIZES = [...new Set([LIST, 20, 5, 1])].filter((n) => n <= LIST);
const tail = (gid) => Number(String(gid).split("/").pop());
const gid = (n) => `gid://shopify/ProductVariant/${n}`;
let made = 0, skipped = 0;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".input.json"))) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const exportFile = path.join(dir, f.replace(/\.input\.json$/, ".export"));
    for (const mode of MODES) {
      let kept = null;
      for (const size of SIZES) {
        const input = structuredClone(src);
        const lines = input.cart.lines;
        const products = [...new Set(lines.map((l) => l.merchandise?.product?.id).filter(Boolean))].slice(0, PRODUCTS);
        const lists = new Map();
        products.forEach((productId, p) => {
          const own = [...new Set(lines.filter((l) => l.merchandise?.product?.id === productId).map((l) => l.merchandise.id))];
          const hit = mode === "last" || (mode === "every10" && p % 10 === 9);
          const hits = hit ? own.slice(0, size) : [];
          const base = 50000000000000 + (tail(productId) % 1000000) * 1000;
          const fillers = Array.from({ length: size - hits.length }, (_, i) => gid(base + i));
          lists.set(productId, [...fillers, ...hits]);
        });
        for (const l of lines) {
          const product = l.merchandise?.product;
          const list = product && lists.get(product.id);
          if (!list) continue;
          const won = (product.wonProduct ??= { jsonValue: {} });
          if (!won.jsonValue || typeof won.jsonValue !== "object") won.jsonValue = {};
          won.jsonValue.outlet = list;
        }
        const limit = inputLimit(lines.length);
        let guard = 0;
        for (let over = messagePackBytes(input) - limit; over > 0 && guard++ < 400; over = messagePackBytes(input) - limit) {
          let freed = 0;
          while (freed < over && (input.enteredDiscountCodes ?? []).length > 25) freed += String(input.enteredDiscountCodes.pop()).length + 2;
          const refs = lines.map((l) => l.merchandise?.product?.wonProduct?.jsonValue?.ruleIds).filter((r) => Array.isArray(r) && r.length);
          while (freed < over && refs.some((r) => r.length)) {
            const best = refs.reduce((a, b) => (b.length > a.length ? b : a));
            freed += String(best.pop()).length + 2;
          }
          if (freed === 0) break;
        }
        if (messagePackBytes(input) <= limit) {
          kept = { input, size };
          break;
        }
      }
      if (!kept) { skipped++; continue; }
      const name = `${path.basename(dir)}__${f.replace(/\.input\.json$/, "")}__${mode}`;
      fs.writeFileSync(path.join(out, `${name}.input.json`), JSON.stringify(kept.input));
      if (fs.existsSync(exportFile)) fs.copyFileSync(exportFile, path.join(out, `${name}.export`));
      fs.writeFileSync(path.join(out, `${name}.spec.json`), JSON.stringify({ mode, size: kept.size, products: PRODUCTS }));
      made++;
    }
  }
}
console.log(`made ${made}, skipped ${skipped}`);
