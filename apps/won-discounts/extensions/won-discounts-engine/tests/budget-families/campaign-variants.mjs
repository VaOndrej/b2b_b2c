// MVP 6 sweep of a LIVE campaign (plan docs/plans/<date>-won-discounts-mvp6.md, "Rozpočet — kampaně"; stop rule fixed
// before the run: ONE pass, every input of the MVP 3 cap-550 families × the modes below, no climbing).
// Every family input runs with the node's campaign live and matching the shop config (campaignActive true, the
// node vars' campaignId + varsVersion = the config's), so the engine resolves the campaign on every run:
//   none      the campaign has no override (the handshake and the resolve loop only);
//   value     overrides patch `value` (+5 points / a doubled amount) of the most-referenced rules, as many as fit the
//             9 000 B config budget;
//   retarget  overrides patch `target` (same kind) of the most-referenced rules, as many as fit; every line's refs to
//             those rules become campaign-scoped (`rule@k`, targeting.ts) — the per-line ref matching of a campaign.
// The input is trimmed back to the MessagePack limit like outlet-flag-variants.mjs (entered codes past 25, then the
// longest product ruleIds) so it stays a possible input.
//   node campaign-variants.mjs <outDir> <familyDir>...
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { messagePackBytes, inputLimit } = await import(`${EXT}/input-size.js`);
const [out, ...dirs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const MODES = process.env.MODES ? process.env.MODES.split(",") : ["none", "value", "retarget"];
const BUDGET = 9000;
const K = "k";
const VERSION = "c0ffee01";
const WINDOW = { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" };
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const refsOf = (l) => l.merchandise?.product?.wonProduct?.jsonValue?.ruleIds;

let made = 0, skipped = 0;
const stats = { value: [], retarget: [] };
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".input.json"))) {
    const src = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const exportFile = path.join(dir, f.replace(/\.input\.json$/, ".export"));
    for (const mode of MODES) {
      const input = structuredClone(src);
      const cfg = input.shop?.config?.jsonValue;
      if (!cfg || !Array.isArray(cfg.modules?.codes?.rules)) { skipped++; continue; }
      cfg.campaignId = K;
      cfg.campaignVarsVersion = VERSION;
      const campaign = { id: K, window: WINDOW, overrides: [] };
      cfg.campaigns = [campaign];
      const vars = input.discount?.vars?.jsonValue;
      if (vars) Object.assign(vars, { campaignId: K, campaignStart: WINDOW.start, campaignEnd: WINDOW.end, varsVersion: VERSION });
      input.shop.localTime = { ...(input.shop.localTime ?? {}), campaignActive: true };
      const lines = input.cart.lines;
      // Rules by how many lines reference them (the costliest to re-target first).
      const freq = new Map();
      for (const l of lines) for (const r of refsOf(l) ?? []) freq.set(r, (freq.get(r) ?? 0) + 1);
      const rules = [...cfg.modules.codes.rules].sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0));
      const retargeted = new Set();
      if (mode !== "none") {
        for (const rule of rules) {
          const patch =
            mode === "value"
              ? { value: rule.value?.kind === "percentage" ? { kind: "percentage", percent: Math.min(100, (rule.value.percent ?? 0) + 5) } : rule.value }
              : { target: { kind: rule.target?.kind ?? "products" } };
          campaign.overrides.push({ ruleId: rule.id, patch });
          if (bytes(cfg) > BUDGET) { campaign.overrides.pop(); break; }
          if (mode === "retarget") retargeted.add(rule.id);
        }
        stats[mode].push(campaign.overrides.length);
      }
      if (retargeted.size) {
        for (const l of lines) {
          const refs = refsOf(l);
          if (Array.isArray(refs)) l.merchandise.product.wonProduct.jsonValue.ruleIds = refs.map((r) => (retargeted.has(r) ? `${r}@${K}` : r));
        }
      }
      const limit = inputLimit(lines.length);
      let guard = 0;
      for (let over = messagePackBytes(input) - limit; over > 0 && guard++ < 400; over = messagePackBytes(input) - limit) {
        let freed = 0;
        while (freed < over && (input.enteredDiscountCodes ?? []).length > 25) freed += String(input.enteredDiscountCodes.pop()).length + 2;
        const refs = lines.map(refsOf).filter((r) => Array.isArray(r) && r.length);
        while (freed < over && refs.some((r) => r.length)) {
          const best = refs.reduce((a, b) => (b.length > a.length ? b : a));
          freed += String(best.pop()).length + 2;
        }
        if (freed === 0) break;
      }
      if (messagePackBytes(input) > limit || bytes(cfg) > BUDGET + 1000) { skipped++; continue; }
      const name = `${path.basename(dir)}__${f.replace(/\.input\.json$/, "")}__${mode}`;
      fs.writeFileSync(path.join(out, `${name}.input.json`), JSON.stringify(input));
      if (fs.existsSync(exportFile)) fs.copyFileSync(exportFile, path.join(out, `${name}.export`));
      made++;
    }
  }
}
const range = (a) => (a.length ? `${Math.min(...a)}–${Math.max(...a)}` : "-");
console.log(`made ${made}, skipped ${skipped}; overrides value ${range(stats.value)}, retarget ${range(stats.retarget)}`);
