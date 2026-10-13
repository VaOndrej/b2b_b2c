// The random payloads of tests/parity.test.js are written the way the shared config was before 13 Oct 2026:
// four category switches in `engine.combination`, `combinesWith` on a rule. Both engines ignore those keys now
// (combine.ts: which discounts add up is said by lists of types and exceptions), so a payload is given the
// lists that say the SAME pairs — and the generators keep covering stacks, blocked shipping and sale lines:
//   - two rules that added up (two of one class linked by `combinesWith` either way; two of different classes
//     by their switch) name each other as exceptions (`x`);
//   - what a rule adds up with outside the rules is in its list `c`: the gift always (16), the free shipping
//     of Milníky by the switches (4), the quantity tiers for an order rule by "product with order" and for a
//     shipping rule by "product with shipping" (8), a line on sale by "outlet with anything" (32);
//   - `engine.mc` = [tiers, rewards, outlet] to match.
// Junk stays junk (a rule that is not a record, an id that is not a string): only what both engines would read
// as a rule gets a list. The old keys stay in the payload (the tests' own bookkeeping reads the switches).

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** product | order | shipping, as plan.ts readRule classes a rule; null for what it does not read as a rule. */
function classOf(rule) {
  if (!isRecord(rule) || typeof rule.id !== "string" || rule.id === "" || !isRecord(rule.value) || !isRecord(rule.target)) return null;
  if (!["percentage", "fixed", "freeShipping"].includes(rule.value.kind)) return null;
  if (!["order", "products", "collections", "shipping"].includes(rule.target.kind)) return null;
  if (rule.value.kind === "freeShipping" || rule.target.kind === "shipping") return "shipping";
  return rule.target.kind === "order" ? "order" : "product";
}

const linksOf = (rule) => (isRecord(rule.combinesWith) && Array.isArray(rule.combinesWith.ruleIds) ? rule.combinesWith.ruleIds.filter((id) => typeof id === "string") : []);

/** Gives the payload `config` (mutated, and returned) the lists that say what its switches and links said. */
export function withLists(config) {
  if (!isRecord(config) || !isRecord(config.modules) || !isRecord(config.modules.codes) || !Array.isArray(config.modules.codes.rules)) return config;
  const c = isRecord(config.engine) && isRecord(config.engine.combination) ? config.engine.combination : {};
  const flag = (key, fallback) => (typeof c[key] === "boolean" ? c[key] : fallback);
  const sw = { outlet: flag("outletWithAnything", false), order: flag("productWithOrder", true), productShipping: flag("productWithShipping", true), orderShipping: flag("orderWithShipping", true) };
  const rules = [];
  const seen = new Set();
  for (const rule of config.modules.codes.rules) {
    const cls = classOf(rule);
    if (cls === null || seen.has(rule.id)) continue;
    seen.add(rule.id);
    rules.push({ rule, cls, links: linksOf(rule), x: [] });
  }
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const [a, b] = [rules[i], rules[j]];
      const classes = [a.cls, b.cls].sort().join("+");
      const adds =
        a.cls === b.cls
          ? a.cls !== "shipping" && (a.links.includes(b.rule.id) || b.links.includes(a.rule.id))
          : classes === "order+product"
            ? sw.order
            : classes === "product+shipping"
              ? sw.productShipping
              : sw.orderShipping;
      if (!adds) continue;
      a.x.push(b.rule.id);
      b.x.push(a.rule.id);
    }
  }
  for (const { rule, cls, x } of rules) {
    let mask = 16;
    if ((cls === "product" && sw.productShipping) || (cls === "order" && sw.orderShipping)) mask |= 4;
    if ((cls === "order" && sw.order) || (cls === "shipping" && sw.productShipping)) mask |= 8;
    if (sw.outlet && cls !== "shipping") mask |= 32;
    rule.c = mask;
    if (x.length > 0) rule.x = x;
  }
  const tiers = (sw.order ? 3 : 0) | (sw.productShipping ? 4 : 0) | 16 | (sw.outlet ? 32 : 0);
  // An order discount of Milníky (an "ms-" rule, combine.ts) follows the Milníky list, and it never added up with
  // another order discount: the list leaves out the types of the shop's other order rules.
  const isMilestone = ({ rule, cls }) => cls === "order" && rule.id.startsWith("ms-") && rule.method !== "code";
  let rewards = 63;
  if (rules.some(isMilestone)) for (const r of rules) if (r.cls === "order" && !isMilestone(r)) rewards &= ~(r.rule.method === "code" ? 2 : 1);
  config.engine = { ...(isRecord(config.engine) ? config.engine : {}), mc: [tiers, rewards, sw.outlet ? 27 : 0] };
  // A campaign's patched `combinesWith` replaced the rule's links: its exceptions for the campaign.
  for (const campaign of Array.isArray(config.campaigns) ? config.campaigns : []) {
    for (const override of isRecord(campaign) && Array.isArray(campaign.overrides) ? campaign.overrides : []) {
      if (isRecord(override) && isRecord(override.patch) && "combinesWith" in override.patch) override.patch.x = linksOf(override.patch);
    }
  }
  return config;
}

const TYPE_OF_BIT = [[1, "automatic"], [2, "code"], [4, "shipping"], [8, "tiers"], [16, "rewards"], [32, "outlet"]];
const typesOf = (mask) => TYPE_OF_BIT.filter(([bit]) => (mask & bit) !== 0).map(([, type]) => type);

/**
 * The same for a merchant CONFIG written the old way (a scenario of tests/scenarios.js: `rules`, and
 * `configExtra.engine.combination`): `combine` on every rule and on the three modules, saying exactly the pairs
 * the switches and `combinesWith` said. Not the app's own conversion of a stored shop (@won/core
 * config/combine-migrate.ts gives every rule of a type one list and takes the stricter side where that cannot
 * say it): a scenario's expected output is its spec, so its pairs are kept one by one, as exceptions.
 * Returns a new config value; `raw` is not changed.
 */
export function configWithLists(raw) {
  const modules = { ...raw.modules };
  const rules = modules.codes.rules.map((rule) => ({ ...rule }));
  const payload = withLists({ engine: raw.engine, modules: { codes: { rules: rules.map((rule) => ({ ...rule })) } } });
  const listed = new Map(payload.modules.codes.rules.filter((r) => typeof r.c === "number").map((r) => [r.id, r]));
  for (const rule of rules) {
    const from = listed.get(rule.id);
    delete rule.combinesWith;
    if (from) rule.combine = { types: typesOf(from.c), ...(from.x ? { rules: from.x } : {}) };
  }
  const [tiers, rewards, outlet] = payload.engine.mc;
  const engine = { ...(isRecord(raw.engine) ? raw.engine : {}) };
  delete engine.combination;
  return {
    ...raw,
    engine,
    modules: {
      ...modules,
      codes: { ...modules.codes, rules },
      tiers: { ...(modules.tiers ?? {}), combine: { types: typesOf(tiers) } },
      rewards: { ...(modules.rewards ?? {}), combine: { types: typesOf(rewards) } },
      outlet: { ...(modules.outlet ?? {}), combine: { types: typesOf(outlet) } },
    },
  };
}

/**
 * Random lists for a payload (parity of the two engines on what the old switches could never say: a tier in a
 * stack, an order discount that adds up with some product discounts only, a sale that takes some types, a gift
 * or a shipping discount that does not add up): every rule a list `c` (nothing, everything, or any six bits)
 * and, some, exceptions `x` by position — with ids, junk and positions that hold no rule among them — and the
 * three modules' lists. `rnd`: a seeded generator of numbers in [0, 1).
 */
export function withRandomLists(config, rnd) {
  if (!isRecord(config) || !isRecord(config.modules) || !isRecord(config.modules.codes) || !Array.isArray(config.modules.codes.rules)) return config;
  const mask = () => {
    const r = rnd();
    return r < 0.2 ? 0 : r < 0.55 ? 63 : Math.floor(rnd() * 64);
  };
  const rules = config.modules.codes.rules;
  rules.forEach((rule, i) => {
    if (!isRecord(rule)) return;
    delete rule.x;
    rule.c = rnd() < 0.03 ? ["63", 63.5, -1, null][Math.floor(rnd() * 4)] : mask();
    if (rnd() < 0.35) {
      rule.x = rules.map((_, j) => j).filter((j) => j !== i && rnd() < 0.5);
      if (rnd() < 0.15) rule.x.push(...[typeof rules[0]?.id === "string" ? rules[0].id : "ghost", 99, -1, 1.5, null].filter(() => rnd() < 0.5));
      // Half of them as the app ships them: one text of positions (with junk parts now and then).
      else if (rnd() < 0.5) rule.x = rule.x.join(",") + (rnd() < 0.1 ? [",", ", 1", ",x", ",123456", ",-0", ",007"][Math.floor(rnd() * 6)] : "");
    }
  });
  const mc = rnd() < 0.04 ? ["x", [63], {}, null][Math.floor(rnd() * 4)] : [mask(), mask(), mask()];
  config.engine = { ...(isRecord(config.engine) ? config.engine : {}), mc };
  return config;
}

/**
 * The lists of a payload moved into `engine.cx`, the one text the app ships (@won/core function-payload.ts):
 * the modules' masks, then each rule's mask and exceptions by position. Only what both engines read the same
 * either way is moved — whole masks, exceptions by position — so a payload with junk in its lists stays as it is.
 * Mutates and returns `config`.
 */
export function withOneText(config) {
  if (!isRecord(config) || !isRecord(config.modules) || !isRecord(config.modules.codes) || !Array.isArray(config.modules.codes.rules)) return config;
  const engine = isRecord(config.engine) ? config.engine : {};
  const isMask = (v) => Number.isInteger(v) && v >= 0 && v <= 63;
  const mc = engine.mc === undefined ? [0, 0, 0] : engine.mc;
  if (!Array.isArray(mc) || mc.length !== 3 || !mc.every(isMask)) return config;
  const rules = config.modules.codes.rules;
  const positions = new Map();
  rules.forEach((rule, at) => {
    if (isRecord(rule) && typeof rule.id === "string" && rule.id !== "" && !positions.has(rule.id)) positions.set(rule.id, at);
  });
  const entries = [];
  for (const rule of rules) {
    if (!isRecord(rule)) {
      entries.push("");
      continue;
    }
    const mask = rule.c === undefined ? 0 : rule.c;
    const x = rule.x === undefined ? [] : typeof rule.x === "string" ? rule.x.split(",") : rule.x;
    if (!isMask(mask) || !Array.isArray(x)) return config;
    const named = [];
    for (const v of x) {
      // An id names the first rule with it (both engines); a position must be a plain whole number.
      const at = typeof v === "string" && /^(0|[1-9][0-9]{0,3})$/.test(v) && typeof rule.x === "string" ? Number(v) : typeof v === "string" && typeof rule.x !== "string" ? positions.get(v) : Number.isInteger(v) && v >= 0 && v < 10000 ? v : null;
      if (at === null) return config;
      if (at !== undefined) named.push(at);
    }
    entries.push(named.length > 0 ? `${mask}:${named.join(",")}` : mask !== 0 ? String(mask) : "");
  }
  for (const rule of rules) {
    if (!isRecord(rule)) continue;
    delete rule.c;
    delete rule.x;
  }
  const rest = { ...engine };
  delete rest.mc;
  config.engine = { ...rest, cx: `${mc.join(".")}|${entries.join(";")}` };
  return config;
}

/**
 * A payload as the Rust function can read it: its lists in `engine.cx` (withOneText), a campaign's patched
 * exceptions as one text of positions. The function reads nothing else (its size limit; README "Accepted edge
 * differences") while the TS reference also reads lists made by hand — on a rule, in `engine.mc`, exceptions as
 * a list or by id. So where the lists cannot be moved (junk in them), they are taken out and `engine.cx` is the
 * text `junk` gives (a junk text now and then: both engines must read it the same). Mutates and returns `config`.
 */
export function sealLists(config, junk = () => "") {
  if (!isRecord(config) || !isRecord(config.modules) || !isRecord(config.modules.codes) || !Array.isArray(config.modules.codes.rules)) return config;
  const rules = config.modules.codes.rules;
  const positions = new Map();
  rules.forEach((rule, at) => {
    if (isRecord(rule) && typeof rule.id === "string" && rule.id !== "" && !positions.has(rule.id)) positions.set(rule.id, at);
  });
  for (const campaign of Array.isArray(config.campaigns) ? config.campaigns : []) {
    for (const override of isRecord(campaign) && Array.isArray(campaign.overrides) ? campaign.overrides : []) {
      if (!isRecord(override) || !isRecord(override.patch) || !("x" in override.patch) || typeof override.patch.x === "string") continue;
      const x = Array.isArray(override.patch.x) ? override.patch.x : [];
      override.patch.x = x
        .map((v) => (typeof v === "string" ? positions.get(v) : Number.isInteger(v) && v >= 0 && v < 10000 ? v : undefined))
        .filter((at) => at !== undefined)
        .join(",");
    }
  }
  withOneText(config);
  if (isRecord(config.engine) && typeof config.engine.cx === "string") return config;
  for (const rule of rules) {
    if (!isRecord(rule)) continue;
    delete rule.c;
    delete rule.x;
  }
  const rest = { ...(isRecord(config.engine) ? config.engine : {}) };
  delete rest.mc;
  config.engine = { ...rest, cx: junk() };
  return config;
}
