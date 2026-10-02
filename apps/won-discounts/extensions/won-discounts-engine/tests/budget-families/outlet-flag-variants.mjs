// MVP 5 sweep of the variant sale flag (plan docs/plans/2026-10-02-won-discounts-mvp5.md, "Rozpočet — výprodej";
// stop rule fixed before the run: ONE pass, every input of the MVP 3 cap-550 families × 3 modes, no climbing).
// The query asks every variant for `wonOutlet` (the metafield `outlet`), so every line carries the field:
//   none     null on every line (no sale in the cart: the common case);
//   every10  `{jsonValue: true}` on every 10th line;
//   all      `{jsonValue: true}` on every line.
// The delivery query no longer asks for `discount.discountClasses` (it paid for `wonOutlet`): dropped from a
// delivery input. The input is trimmed back to the MessagePack limit like rewards-variants.mjs (entered codes
// past 25, then the longest product ruleIds) so it stays a possible input.
//   node outlet-flag-variants.mjs <outDir> <familyDir>...
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { messagePackBytes, inputLimit } = await import(`${EXT}/input-size.js`);
const [out, ...dirs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const MODES = process.env.MODES ? process.env.MODES.split(",") : ["none", "every10", "all"];
let made = 0, skipped = 0;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".input.json"))) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const exportFile = path.join(dir, f.replace(/\.input\.json$/, ".export"));
    const delivery = fs.existsSync(exportFile) ? fs.readFileSync(exportFile, "utf8").includes("delivery") : !!src.cart?.deliveryGroups;
    for (const mode of MODES) {
      const input = structuredClone(src);
      if (delivery && input.discount) delete input.discount.discountClasses;
      const lines = input.cart.lines;
      lines.forEach((l, k) => {
        const m = l.merchandise;
        if (!m || m.__typename !== "ProductVariant") return;
        const on = mode === "all" || (mode === "every10" && k % 10 === 9);
        // Insert after wonVariant (the query's field order).
        const rebuilt = {};
        for (const [key, value] of Object.entries(m)) {
          if (key === "product") rebuilt.wonOutlet = on ? { jsonValue: true } : null;
          rebuilt[key] = value;
        }
        l.merchandise = rebuilt;
      });
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
      if (messagePackBytes(input) > limit) { skipped++; continue; }
      const name = `${path.basename(dir)}__${f.replace(/\.input\.json$/, "")}__${mode}`;
      fs.writeFileSync(path.join(out, `${name}.input.json`), JSON.stringify(input));
      if (fs.existsSync(exportFile)) fs.copyFileSync(exportFile, path.join(out, `${name}.export`));
      made++;
    }
  }
}
console.log(`made ${made}, skipped ${skipped}`);
