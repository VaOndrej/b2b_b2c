// MVP 4 adversarial rewards sweep (stop rule fixed before the run: ONE pass, every input of the MVP 3 cap-550
// families × 3 reward variants; no climbing). Each variant puts the costliest rewards payload that FITS the
// config's 9 000 B (room taken from marketCountries, as the families took the tiers' room) — 64-char tier ids,
// 4 numeric variants a tier, every currency of the cart at a reached threshold, free shipping, o:1 — and gift
// attributes on lines (valid gifts: the line's variant is a tier variant) per mode; the input is trimmed back to
// the MessagePack limit (entered codes past 25, then the longest product ruleIds) so it stays a possible input.
//   node gen.mjs <outDir> <familyDir>...
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { messagePackBytes, inputLimit } = await import(`${EXT}/input-size.js`);
const [out, ...dirs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const tierId = (i) => (process.env.SMALL ? `g${i}` : `gift-${i}-`.padEnd(64, "x"));
const tail = (gid) => Number(String(gid).split("/").pop());
const SMALL = !!process.env.SMALL;
const MODES = SMALL ? ["every10", "none"] : ["every10", "all", "none"];
let made = 0, skipped = 0;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".input.json"))) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const exportFile = path.join(dir, f.replace(/\.input\.json$/, ".export"));
    for (const mode of MODES) {
      const input = structuredClone(src);
      const cfg = input.shop.config.jsonValue;
      const lines = input.cart.lines;
      const cur = input.cart.cost?.subtotalAmount?.currencyCode ?? input.localization?.country?.currency?.isoCode ?? "CZK";
      const currency = input.presentmentCurrency ?? cur;
      // Gift variants: real line variants (valid gifts) first, then synthetic ones.
      const lineVariants = [...new Set(lines.map((l) => tail(l.merchandise?.id)).filter(Number.isFinite))];
      const variantsFor = (i) => (SMALL ? [0] : [0, 1, 2, 3]).map((k) => lineVariants[(i * 4 + k) % Math.max(1, lineVariants.length)] ?? 48468678902001 + i * 4 + k);
      const money = Object.fromEntries((SMALL ? [cur] : [...new Set([cur, "CZK", "EUR", "USD", "HUF", "PLN"])]).map((c) => [c, 1]));
      const tierFor = (i) => [tierId(i), Object.fromEntries(Object.keys(money).map((c) => [c, 1 + i])), variantsFor(i)];
      let tiers = SMALL ? 1 : 10;
      let json;
      const mc = cfg.marketCountries;
      for (; tiers >= 1; tiers--) {
        cfg.marketCountries = mc;
        cfg.modules.rewards = { s: Object.fromEntries(Object.keys(money).map((c) => [c, 1])), g: Array.from({ length: tiers }, (_, i) => tierFor(i)), o: 1 };
        json = JSON.stringify(cfg);
        // Take room from marketCountries (the families' own room source) entry by entry.
        if (mc && typeof mc === "object") {
          const keys = Object.keys(mc);
          const trimmed = { ...mc };
          while (json.length > 9000 && keys.length) { delete trimmed[keys.pop()]; cfg.marketCountries = trimmed; json = JSON.stringify(cfg); }
        }
        if (json.length <= 9000) break;
      }
      if (tiers < 1) { skipped++; continue; }
      const ids = cfg.modules.rewards.g.map((t) => t[0]);
      lines.forEach((l, k) => {
        const on = mode === "all" || (mode === "every10" && k % 10 === 9);
        l.gift = on ? { value: ids[k % ids.length] } : null;
      });
      // Back to the input limit: entered codes past 25, then the longest product ruleIds.
      const limit = inputLimit(lines.length);
      // Batched: drop about the bytes over (each entry's own size + 1), then measure again.
      let guard = 0;
      for (let over = messagePackBytes(input) - limit; over > 0 && guard++ < 200; over = messagePackBytes(input) - limit) {
        let freed = 0;
        while (freed < over && (input.enteredDiscountCodes ?? []).length > 25) freed += String(input.enteredDiscountCodes.pop()).length + 2;
        const lists = lines.map((l) => l.merchandise?.product?.wonProduct?.jsonValue?.ruleIds).filter((r) => Array.isArray(r) && r.length);
        while (freed < over && lists.some((r) => r.length)) {
          const best = lists.reduce((a, b) => (b.length > a.length ? b : a));
          freed += String(best.pop()).length + 2;
        }
        if (freed === 0) break;
      }
      if (messagePackBytes(input) > limit) { skipped++; continue; }
      const name = `${path.basename(dir)}__${f.replace(/\.input\.json$/, "")}__${mode}`;
      fs.writeFileSync(path.join(out, `${name}.input.json`), JSON.stringify(input));
      if (fs.existsSync(exportFile)) fs.copyFileSync(exportFile, path.join(out, `${name}.export`));
      fs.writeFileSync(path.join(out, `${name}.spec.json`), JSON.stringify({ tiers, mode, cfg: json.length, currency }));
      made++;
    }
  }
}
console.log(`made ${made}, skipped ${skipped}`);
