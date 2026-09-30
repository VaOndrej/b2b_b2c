// The shared config (function-payload.ts FunctionConfigPayload) as plan.ts
// reads it: every key the engine looks at, read with the same `typeof` checks
// (isRecord, stringList, clampPercent, localDate, …), and nothing else. The
// cart currency is not known here; money stays per currency (`Money`) and
// plan.rs picks the cart's.
//
// A campaign override patches a rule with a shallow merge (`{...raw, ...patch}`)
// of the keys in RULE_OVERRIDE_KEYS, so every patchable key is kept as its own
// reading (`RuleFields`) and a `RulePatch` replaces the readings whose keys it
// has — present with any value, null included.

use shopify_function::wasm_api::Value;

use super::hash::MAX_CODE_LENGTH;
use super::js;
use super::margin::{read_margin_payload, MarginPayload};
use crate::json::{entries, has_string, is_true, non_empty, number, prop, string, string_list, Fields, Key};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    Order,
    Products,
    Collections,
    Shipping,
}

/// A MoneyByCurrency value: `NotRecord` for anything but a JSON object; each
/// currency's value is kept when it is a (finite) number.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Money {
    #[default]
    NotRecord,
    Record(Vec<(String, Option<f64>)>),
}

/// CONFIG_LIMITS.moneyMinorUnits (limits.ts): the sanitizer caps every stored
/// amount there, and both engines read a larger hand-made one as the cap.
pub const MAX_MONEY_MINOR: f64 = 1e12;

impl Money {
    fn lookup(&self, currency: &str) -> Option<f64> {
        match self {
            Money::NotRecord => None,
            // JSON.parse keeps the last of duplicate keys.
            Money::Record(list) => list.iter().rev().find(|(k, _)| k == currency).and_then(|(_, v)| *v),
        }
    }

    /// `amountIn` (plan.ts): a finite number ≥ 0, at most MAX_MONEY_MINOR, floored; else none.
    pub fn amount_in(&self, currency: &str) -> Option<i64> {
        self.lookup(currency).filter(|v| *v >= 0.0).map(|v| js::floor_to_i64(v.min(MAX_MONEY_MINOR)))
    }

    /// `moneyFor` (money.ts), as describe.ts phrases it: the raw number.
    pub fn money_for(&self, currency: &str) -> Option<f64> {
        self.lookup(currency)
    }

    /// `isRecord(m) && Object.keys(m).length > 0`.
    pub fn is_non_empty_record(&self) -> bool {
        matches!(self, Money::Record(list) if !list.is_empty())
    }
}

/// `raw.value`: readRule keeps the rule only for these three kinds.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum ValueSpec {
    #[default]
    Invalid,
    /// `clampPercent(value.percent)`: 0–100, 0 for anything but a number.
    Percentage(f64),
    /// `value.amount` per currency.
    Fixed(Money),
    FreeShipping,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Minimum {
    pub subtotal: Money,
    /// `minimum.quantity` when a number > 0, floored; else 0.
    pub quantity: i64,
    /// `minimum.scope === "entitled"`: only the rule's own lines count (else the whole cart).
    pub entitled: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Targeting {
    /// Pro market handles (`stringList(targeting.markets)`).
    pub markets: Option<Vec<String>>,
    /// `stringList(targeting.segments)` is non-empty: not evaluable in checkout yet.
    pub segment_targeted: bool,
}

/// The keys a campaign override may patch (RULE_OVERRIDE_KEYS), as readRule reads them.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RuleFields {
    /// `raw.enabled === true`.
    pub enabled: bool,
    /// `typeof raw.name === "string" ? raw.name : ""`.
    pub name: String,
    pub value: ValueSpec,
    /// `raw.target.kind` when it is one of DISCOUNT_TARGET_KINDS.
    pub target: Option<TargetKind>,
    pub minimum: Minimum,
    pub targeting: Targeting,
    /// `combinesWith.ruleIds` (Pro).
    pub combines: Vec<String>,
}

/// One campaign override's patch: `Some` for every key the patch object has.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RulePatch {
    pub enabled: Option<bool>,
    pub name: Option<String>,
    pub value: Option<ValueSpec>,
    pub target: Option<Option<TargetKind>>,
    pub minimum: Option<Minimum>,
    pub targeting: Option<Targeting>,
    pub combines: Option<Vec<String>>,
}

/// The patchable keys of one rule as readRule sees them, borrowed from the
/// config: the raw rule's, each replaced by the last override that has the key.
#[derive(Debug, Clone, Copy)]
pub struct FieldsRef<'a> {
    pub enabled: bool,
    pub name: &'a str,
    pub value: &'a ValueSpec,
    pub target: Option<TargetKind>,
    pub minimum: &'a Minimum,
    pub targeting: &'a Targeting,
    pub combines: &'a [String],
}

impl RuleFields {
    pub fn view(&self) -> FieldsRef<'_> {
        FieldsRef {
            enabled: self.enabled,
            name: &self.name,
            value: &self.value,
            target: self.target,
            minimum: &self.minimum,
            targeting: &self.targeting,
            combines: &self.combines,
        }
    }
}

impl RulePatch {
    /// `"target" in patch`: the campaign re-targets the rule (campaign-scoped refs apply).
    pub fn retargets(&self) -> bool {
        self.target.is_some()
    }

    /// `{...raw, ...patch}` over the patchable keys. Applying a rule's overrides
    /// one after another is activeCampaign's key-by-key merge (a later override
    /// of the same key wins).
    pub fn overlay<'a>(&'a self, base: FieldsRef<'a>) -> FieldsRef<'a> {
        FieldsRef {
            enabled: self.enabled.unwrap_or(base.enabled),
            name: self.name.as_deref().unwrap_or(base.name),
            value: self.value.as_ref().unwrap_or(base.value),
            target: self.target.unwrap_or(base.target),
            minimum: self.minimum.as_ref().unwrap_or(base.minimum),
            targeting: self.targeting.as_ref().unwrap_or(base.targeting),
            combines: self.combines.as_deref().unwrap_or(base.combines),
        }
    }
}

/// A rule as the config carries it (only entries that are records with a
/// non-empty string id: resolveRules skips every other entry).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RawRule {
    pub id: String,
    /// `raw.method === "code"`.
    pub method_code: bool,
    /// Code rules: `stringList(raw.codeHashes) ?? []`.
    pub code_hashes: Vec<String>,
    /// `Math.floor(raw.priority)` when a number, else 0.
    pub priority: i64,
    /// `raw.schedule` is neither undefined nor null.
    pub scheduled: bool,
    /// Scheduled, but not exactly valid `startsOn`/`endsOn` shop days: never live.
    pub schedule_invalid: bool,
    pub starts_on: Option<String>,
    pub ends_on: Option<String>,
    pub fields: RuleFields,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RawCampaign {
    /// `c.id` when a string.
    pub id: Option<String>,
    /// `c.killed === true`.
    pub killed: bool,
    /// Overrides that are records with a string `ruleId` and a record `patch`, in order.
    pub overrides: Vec<(String, RulePatch)>,
}

/// engine.combination: the Free per-category switches (DEFAULT_CONFIG for anything not a boolean).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EngineFlags {
    pub outlet_with_anything: bool,
    pub product_with_order: bool,
    pub product_with_shipping: bool,
    pub order_with_shipping: bool,
}

impl Default for EngineFlags {
    fn default() -> Self {
        Self { outlet_with_anything: false, product_with_order: true, product_with_shipping: true, order_with_shipping: true }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Config {
    /// `config.campaignId` when a string (compared with `===` to the node's campaign).
    pub campaign_id: Option<String>,
    pub campaign_vars_version: Option<String>,
    pub engine: EngineFlags,
    /// Market handle → upper-case countries.
    pub market_countries: Vec<(String, Vec<String>)>,
    pub rules: Vec<RawRule>,
    /// Record entries of `config.campaigns`, in order.
    pub campaigns: Vec<RawCampaign>,
    /// `modules.margin` when margin protection is ON (margin.rs `read_margin_payload`); none = off.
    pub margin: Option<MarginPayload>,
    /// `modules.codes.maxCodeLength` (plan.ts `readMaxCodeLength`): the longest
    /// Won code, UTF-16 units; an entered code longer than it after trimming is
    /// never upper-cased or matched (it cannot be a Won code).
    pub max_code_length: usize,
}

/// `readMaxCodeLength` (plan.ts): a whole number ≥ 0, at most MAX_CODE_LENGTH;
/// anything else (a payload written before audit round 6) reads as MAX_CODE_LENGTH.
fn read_max_code_length(value: &Value) -> usize {
    match number(value) {
        Some(n) if n >= 0.0 && n.fract() == 0.0 => n.min(MAX_CODE_LENGTH as f64) as usize,
        _ => MAX_CODE_LENGTH,
    }
}

// --- Reading from the input -------------------------------------------------------------------

/// A MoneyByCurrency value. With the cart currency (`cur`, the function run),
/// only that entry is read — the engine never looks another one up — and
/// whether the record has any key (`Money::is_non_empty_record`): a
/// fixed-amount rule costs one lookup instead of reading every currency's key
/// and value (config reads were ~0.4 M instructions of a Pro cart).
fn read_money(value: &Value, cur: Option<&str>) -> Money {
    if !value.is_obj() {
        return Money::NotRecord;
    }
    match cur {
        Some(_) if value.obj_len() == Some(0) => Money::Record(Vec::new()),
        Some(cur) => Money::Record(vec![(cur.to_string(), number(&value.get_obj_prop(cur)))]),
        None => Money::Record(entries(value).into_iter().map(|(k, v)| (k, number(&v))).collect()),
    }
}

fn read_value(value: &Value, cur: Option<&str>) -> ValueSpec {
    if !value.is_obj() {
        return ValueSpec::Invalid;
    }
    match string(&prop(value, Key::Kind)).as_deref() {
        Some("percentage") => {
            let percent = number(&prop(value, Key::Percent)).map_or(0.0, |p| p.clamp(0.0, 100.0));
            // Math.max(0, -0) is +0.
            ValueSpec::Percentage(if percent == 0.0 { 0.0 } else { percent })
        }
        Some("fixed") => ValueSpec::Fixed(read_money(&prop(value, Key::Amount), cur)),
        Some("freeShipping") => ValueSpec::FreeShipping,
        _ => ValueSpec::Invalid,
    }
}

fn read_target(value: &Value) -> Option<TargetKind> {
    if !value.is_obj() {
        return None;
    }
    match string(&prop(value, Key::Kind)).as_deref() {
        Some("order") => Some(TargetKind::Order),
        Some("products") => Some(TargetKind::Products),
        Some("collections") => Some(TargetKind::Collections),
        Some("shipping") => Some(TargetKind::Shipping),
        _ => None,
    }
}

fn read_minimum(value: &Value, cur: Option<&str>) -> Minimum {
    if !value.is_obj() {
        return Minimum::default();
    }
    Minimum {
        subtotal: read_money(&prop(value, Key::Subtotal), cur),
        quantity: number(&prop(value, Key::Quantity)).filter(|q| *q > 0.0).map_or(0, js::floor_to_i64),
        entitled: string(&prop(value, Key::Scope)).as_deref() == Some("entitled"),
    }
}

/// How a rule's market handles are read. `All`: every handle (`stringList`).
/// `Here(handles)`: the function run, which knows the cart's markets (audit
/// round 7) — the handles of the markets that hold the cart's country — and
/// reads a rule's handles only until one of them. `markets` is then the list
/// `inMarket` decides the same on: `[that handle]`, `[]` when none of its
/// handles is one of them (but it lists a string), none when it lists no string.
#[derive(Debug, Clone, Copy)]
enum HandleRead<'h> {
    All,
    Here(&'h [String]),
}

fn read_markets(list: &Value, read: HandleRead) -> Option<Vec<String>> {
    let HandleRead::Here(here) = read else { return string_list(list) };
    let mut listed = false;
    for i in 0..list.array_len()? {
        if let Some(handle) = list.get_at_index(i).as_string() {
            if here.contains(&handle) {
                return Some(vec![handle]);
            }
            listed = true;
            if here.is_empty() {
                break;
            }
        }
    }
    listed.then(Vec::new)
}

/// A market's countries (`stringList`), read for the function run: whether it
/// lists a string, and whether one of them upper-cased is the cart's country
/// (`country`, upper-case ISO 3166-1 alpha-2; none: the cart has no valid
/// country, which no market holds) — read until that one.
fn market_holds(countries: &Value, country: Option<&str>) -> (bool, bool) {
    let mut listed = false;
    for i in 0..countries.array_len().unwrap_or(0) {
        if let Some(c) = countries.get_at_index(i).as_string() {
            listed = true;
            let Some(country) = country else { break };
            // `c.toUpperCase() === country`; an ASCII country compared as it is.
            let holds = if c.is_ascii() { c.len() == country.len() && c.bytes().zip(country.bytes()).all(|(a, b)| a.to_ascii_uppercase() == b) } else { js::upper(&c) == country };
            if holds {
                return (true, true);
            }
        }
    }
    (listed, false)
}

fn read_targeting(value: &Value, read: HandleRead) -> Targeting {
    if !value.is_obj() {
        return Targeting::default();
    }
    Targeting {
        markets: read_markets(&prop(value, Key::Markets), read),
        // `stringList(segments) !== null`: read up to its first string.
        segment_targeted: has_string(&prop(value, Key::Segments)),
    }
}

fn read_combines(value: &Value) -> Vec<String> {
    if !value.is_obj() {
        return Vec::new();
    }
    string_list(&prop(value, Key::RuleIds)).unwrap_or_default()
}


fn read_patch(patch: &Value, cur: Option<&str>, markets: HandleRead) -> RulePatch {
    let mut out = RulePatch::default();
    for (key, value) in entries(patch) {
        match key.as_str() {
            "enabled" => out.enabled = Some(is_true(&value)),
            "name" => out.name = Some(string(&value).unwrap_or_default()),
            "value" => out.value = Some(read_value(&value, cur)),
            "target" => out.target = Some(read_target(&value)),
            "minimum" => out.minimum = Some(read_minimum(&value, cur)),
            "targeting" => out.targeting = Some(read_targeting(&value, markets)),
            "combinesWith" => out.combines = Some(read_combines(&value)),
            _ => {}
        }
    }
    out
}

fn read_local_date(value: &Value) -> Option<String> {
    string(value).filter(|s| js::is_local_date(s))
}

/// `readRule` (plan.ts): the keys a stored rule usually has first, the optional
/// ones after them — once every key of the rule was found, the rest are known to
/// be absent without reading them (json.rs `Fields`).
fn read_rule(raw: &Value, cur: Option<&str>, markets: HandleRead) -> Option<RawRule> {
    if !raw.is_obj() {
        return None;
    }
    let mut f = Fields::new(raw);
    let id = f.get(Key::Id).and_then(|v| non_empty(&v))?;
    let method_code = f.get(Key::Method).and_then(|v| string(&v)).as_deref() == Some("code");
    let enabled = f.get(Key::Enabled).is_some_and(|v| is_true(&v));
    let name = f.get(Key::Name).and_then(|v| string(&v)).unwrap_or_default();
    let value = f.get(Key::Value).map_or(ValueSpec::Invalid, |v| read_value(&v, cur));
    let target = f.get(Key::Target).and_then(|v| read_target(&v));
    let combines = f.get(Key::CombinesWith).map_or_else(Vec::new, |v| read_combines(&v));
    let code_hashes = if method_code { f.get(Key::CodeHashes).and_then(|v| string_list(&v)).unwrap_or_default() } else { Vec::new() };
    let priority = f.get(Key::Priority).and_then(|v| number(&v)).map_or(0, js::floor_to_i64);
    let minimum = f.get(Key::Minimum).map_or_else(Minimum::default, |v| read_minimum(&v, cur));
    let targeting = f.get(Key::Targeting).map_or_else(Targeting::default, |v| read_targeting(&v, markets));
    let schedule = f.get(Key::Schedule);
    let scheduled = schedule.is_some_and(|s| !s.is_null());
    let (mut schedule_invalid, mut starts_on, mut ends_on) = (false, None, None);
    if let Some(schedule) = schedule.filter(|_| scheduled) {
        if schedule.is_obj() {
            let keys = entries(&schedule);
            schedule_invalid = keys.is_empty()
                || keys.iter().any(|(k, v)| (k != "startsOn" && k != "endsOn") || read_local_date(v).is_none());
            starts_on = read_local_date(&prop(&schedule, Key::StartsOn));
            ends_on = read_local_date(&prop(&schedule, Key::EndsOn));
        } else {
            schedule_invalid = true;
        }
    }
    Some(RawRule {
        id,
        method_code,
        code_hashes,
        priority,
        scheduled,
        schedule_invalid,
        starts_on,
        ends_on,
        fields: RuleFields { enabled, name, value, target, minimum, targeting, combines },
    })
}

fn read_campaign(value: &Value, cur: Option<&str>, markets: HandleRead) -> Option<RawCampaign> {
    if !value.is_obj() {
        return None;
    }
    let overrides_value = prop(value, Key::Overrides);
    let mut overrides = Vec::new();
    for i in 0..overrides_value.array_len().unwrap_or(0) {
        let entry = overrides_value.get_at_index(i);
        if !entry.is_obj() {
            continue;
        }
        let (Some(rule_id), patch) = (string(&prop(&entry, Key::RuleId)), prop(&entry, Key::Patch)) else { continue };
        if patch.is_obj() {
            overrides.push((rule_id, read_patch(&patch, cur, markets)));
        }
    }
    Some(RawCampaign { id: string(&prop(value, Key::Id)), killed: is_true(&prop(value, Key::Killed)), overrides })
}

fn read_engine(config: &Value) -> EngineFlags {
    let defaults = EngineFlags::default();
    let combination = prop(&prop(config, Key::Engine), Key::Combination);
    let flag = |key: Key, default: bool| prop(&combination, key).as_bool().unwrap_or(default);
    EngineFlags {
        outlet_with_anything: flag(Key::OutletWithAnything, defaults.outlet_with_anything),
        product_with_order: flag(Key::ProductWithOrder, defaults.product_with_order),
        product_with_shipping: flag(Key::ProductWithShipping, defaults.product_with_shipping),
        order_with_shipping: flag(Key::OrderWithShipping, defaults.order_with_shipping),
    }
}

impl Config {
    /// `isFunctionConfigPayload(value) ? <the config> : null` — the shape planCart
    /// accepts (a record with `modules.codes.rules` an array); everything inside
    /// is read tolerantly, junk rules are skipped one by one.
    pub fn read(value: &Value) -> Option<Config> {
        Self::read_with(value, None, None)
    }

    /// `read` for a cart in currency `cur` whose country is `country` (the
    /// function run; upper-case ISO 3166-1 alpha-2 as normalizeCart makes it,
    /// none when the cart has no valid one): money is read in that currency only
    /// (`read_money`), the one plan.rs looks up, and markets only as far as the
    /// cart's country decides them (audit round 7: every country and handle read
    /// as a string cost ~780 instructions): `market_countries` lists only the
    /// markets that hold the country (as `[country]`; a market that does not is
    /// `[]`), and a rule's `markets` is read until one of those (`read_markets`).
    /// Every decision `markets_here` / `in_market` make is the same as on the
    /// whole lists.
    pub fn read_in(value: &Value, cur: Option<&str>, country: Option<&str>) -> Option<Config> {
        Self::read_with(value, cur, Some(country))
    }

    fn read_with(value: &Value, cur: Option<&str>, country: Option<Option<&str>>) -> Option<Config> {
        if !value.is_obj() {
            return None;
        }
        let modules = prop(value, Key::Modules);
        let codes = prop(&modules, Key::Codes);
        let rules = prop(&codes, Key::Rules);
        if !modules.is_obj() || !codes.is_obj() {
            return None;
        }
        let rule_count = rules.array_len()?;

        let mut market_countries: Vec<(String, Vec<String>)> = Vec::new();
        for (handle, countries) in entries(&prop(value, Key::MarketCountries)) {
            let list = match country {
                None => string_list(&countries).map(|list| list.iter().map(|c| js::upper(c)).collect()),
                Some(country) => match market_holds(&countries, country) {
                    (false, _) => None,
                    (true, holds) => Some(if holds { country.map(str::to_string).into_iter().collect() } else { Vec::new() }),
                },
            };
            if let Some(list) = list {
                market_countries.retain(|(h, _)| *h != handle);
                market_countries.push((handle, list));
            }
        }
        let here: Vec<String> = market_countries.iter().filter(|(_, list)| !list.is_empty()).map(|(h, _)| h.clone()).collect();
        let markets = if country.is_some() { HandleRead::Here(&here) } else { HandleRead::All };
        let campaigns_value = prop(value, Key::Campaigns);
        let campaigns =
            (0..campaigns_value.array_len().unwrap_or(0)).filter_map(|i| read_campaign(&campaigns_value.get_at_index(i), cur, markets)).collect();

        Some(Config {
            campaign_id: string(&prop(value, Key::CampaignId)),
            campaign_vars_version: string(&prop(value, Key::CampaignVarsVersion)),
            engine: read_engine(value),
            market_countries,
            rules: (0..rule_count).filter_map(|i| read_rule(&rules.get_at_index(i), cur, markets)).collect(),
            campaigns,
            margin: read_margin_payload(&prop(&modules, Key::Margin)),
            max_code_length: read_max_code_length(&prop(&codes, Key::MaxCodeLength)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::ShopConfig;
    use shopify_function::run_function_with_input;

    fn read(json: &str) -> Option<Config> {
        run_function_with_input(|c: ShopConfig| Ok(c), json).unwrap().0
    }

    fn read_for(json: &str, country: Option<&str>) -> Option<Config> {
        run_function_with_input(|v: Value| Ok(Config::read_in(&v, None, country)), json).unwrap()
    }

    /// Read for the cart's country (audit round 7), markets decide exactly as on
    /// the whole lists: the markets that hold the country, and for every rule and
    /// campaign patch whether one of its handles is one of them — for lower-case,
    /// non-ASCII (ſ → S, ı → I), junk and empty lists, duplicate-looking handles,
    /// no country, and handles listed anywhere.
    #[test]
    fn markets_read_for_the_carts_country_decide_as_the_whole_lists() {
        let rule = |id: &str, markets: &str| format!(r#"{{"id": "{id}", "enabled": true, "value": {{"kind": "percentage", "percent": 5}}, "target": {{"kind": "products"}}, "targeting": {{"markets": {markets}}}}}"#);
        let rules = [
            rule("a", r#"["other", "eu"]"#),
            rule("b", r#"["other"]"#),
            rule("c", "[1, 2]"),
            rule("d", "[]"),
            rule("e", r#"["none", "us", 7, "cz2"]"#),
            rule("f", r#""eu""#),
            rule("g", r#"["missing", "ı", "eu", "other"]"#),
            r#"{"id": "h", "enabled": true, "value": {"kind": "percentage", "percent": 5}, "target": {"kind": "products"}}"#.to_string(),
        ]
        .join(",");
        let json = format!(
            r#"{{"marketCountries": {{"eu": ["sk", "cz", 3], "cz2": ["ſk", "Cz"], "none": [], "junk": 5, "other": ["DE", "de"], "us": [null, "us"], "ı": ["ıt", "IT"]}},
               "modules": {{"codes": {{"rules": [{rules}]}}}},
               "campaigns": [{{"id": "k", "overrides": [{{"ruleId": "b", "patch": {{"targeting": {{"markets": ["eu", "us"]}}}}}}, {{"ruleId": "a", "patch": {{"targeting": {{"markets": [3]}}}}}}]}}]}}"#
        );
        let whole = read(&json).unwrap();
        assert_eq!(whole.market_countries.len(), 5);
        let decide = |config: &Config, country: Option<&str>| {
            let here: Vec<&str> = config.market_countries.iter().filter(|(_, list)| country.is_some_and(|c| list.iter().any(|x| x == c))).map(|(h, _)| h.as_str()).collect();
            let decides = |t: &Targeting| t.markets.as_ref().map(|m| m.iter().any(|h| here.contains(&h.as_str())));
            let rules: Vec<_> = config.rules.iter().map(|r| decides(&r.fields.targeting)).collect();
            let patches: Vec<_> = config.campaigns.iter().flat_map(|c| c.overrides.iter().map(|(_, p)| p.targeting.as_ref().map(decides))).collect();
            let mut here: Vec<String> = here.iter().map(|h| h.to_string()).collect();
            here.sort();
            (here, rules, patches)
        };
        for country in [Some("CZ"), Some("SK"), Some("US"), Some("DE"), Some("IT"), Some("FR"), None] {
            let cut = read_for(&json, country).unwrap();
            assert_eq!(decide(&cut, country), decide(&whole, country), "{country:?}");
            // Only the markets that hold the country keep it; a rule keeps at most one handle.
            assert!(cut.market_countries.iter().all(|(_, list)| list.len() <= 1));
            assert!(cut.rules.iter().all(|r| r.fields.targeting.markets.as_ref().is_none_or(|m| m.len() <= 1)));
        }
        assert_eq!(decide(&whole, Some("SK")).0, vec!["cz2", "eu"]);
        assert_eq!(decide(&whole, Some("IT")).0, vec!["ı"]);
    }

    #[test]
    fn only_the_payload_shape_is_a_config() {
        assert!(read("null").is_none());
        assert!(read(r#"{"percent": 9}"#).is_none());
        assert!(read(r#"{"modules": {"codes": {"rules": {}}}}"#).is_none());
        assert!(read(r#"{"modules": [], "x": 1}"#).is_none());
        assert!(read(r#"[{"modules": {"codes": {"rules": []}}}]"#).is_none());
        let config = read(r#"{"modules": {"codes": {"rules": []}}}"#).unwrap();
        assert_eq!(config.engine, EngineFlags::default());
        assert!(config.rules.is_empty());
    }

    #[test]
    fn reads_the_longest_code_length() {
        let len = |extra: &str| read(&format!(r#"{{"modules": {{"codes": {{"rules": []{extra}}}}}}}"#)).unwrap().max_code_length;
        assert_eq!(len(""), MAX_CODE_LENGTH);
        assert_eq!(len(r#", "maxCodeLength": 9"#), 9);
        assert_eq!(len(r#", "maxCodeLength": 9.0"#), 9);
        assert_eq!(len(r#", "maxCodeLength": 0"#), 0);
        assert_eq!(len(r#", "maxCodeLength": 64"#), 64);
        for junk in ["9.5", "-1", r#""9""#, "null", "[9]", "1e300", "65", "255", "true"] {
            assert_eq!(len(&format!(r#", "maxCodeLength": {junk}"#)), MAX_CODE_LENGTH, "{junk}");
        }
    }

    #[test]
    fn reads_rules_tolerantly() {
        let config = read(
            r#"{"modules": {"codes": {"rules": [
                42, {"id": ""}, {"name": "no id"},
                {"id": "a", "enabled": true, "name": 5, "method": "code", "codeHashes": ["00000001", 7],
                 "value": {"kind": "percentage", "percent": 140}, "target": {"kind": "products"}, "priority": 2.7,
                 "minimum": {"subtotal": {"CZK": 1000.9, "EUR": "5"}, "quantity": 2.5},
                 "targeting": {"markets": ["cz", 1], "segments": []}, "combinesWith": {"ruleIds": ["b"]}},
                {"id": "b", "method": "automatic", "codeHashes": ["00000002"], "value": {"kind": "fixed", "amount": [1]},
                 "target": {"kind": "everything"}, "schedule": {"startsOn": "2026-10-01", "at": "x"}}
            ]}},
            "engine": {"combination": {"productWithOrder": false, "orderWithShipping": "no"}},
            "marketCountries": {"eu": ["cz", "sk", 3], "none": []}}"#,
        )
        .unwrap();
        assert_eq!(config.rules.len(), 2);
        let a = &config.rules[0];
        assert!(a.method_code && a.fields.enabled);
        assert_eq!(a.code_hashes, vec!["00000001"]);
        assert_eq!(a.fields.name, "");
        assert_eq!(a.fields.value, ValueSpec::Percentage(100.0));
        assert_eq!(a.priority, 2);
        assert_eq!(a.fields.minimum.subtotal.amount_in("CZK"), Some(1000));
        assert_eq!(a.fields.minimum.subtotal.amount_in("EUR"), None);
        assert_eq!(a.fields.minimum.quantity, 2);
        assert_eq!(a.fields.targeting.markets, Some(vec!["cz".to_string()]));
        assert!(!a.fields.targeting.segment_targeted);
        assert_eq!(a.fields.combines, vec!["b"]);
        assert!(!a.scheduled);
        let b = &config.rules[1];
        assert!(!b.method_code && b.code_hashes.is_empty());
        assert_eq!(b.fields.value, ValueSpec::Fixed(Money::NotRecord));
        assert_eq!(b.fields.target, None);
        assert!(b.scheduled && b.schedule_invalid);
        assert_eq!(b.starts_on.as_deref(), Some("2026-10-01"));
        assert!(!config.engine.product_with_order && config.engine.order_with_shipping);
        assert_eq!(config.market_countries, vec![("eu".to_string(), vec!["CZ".to_string(), "SK".to_string()])]);
    }

    #[test]
    fn a_patch_replaces_only_its_keys_null_included() {
        let config = read(
            r#"{"modules": {"codes": {"rules": [{"id": "a", "enabled": true, "name": "A",
                "value": {"kind": "percentage", "percent": 10}, "target": {"kind": "products"}}]}},
              "campaigns": [7, {"id": "bf", "killed": false, "overrides": [
                {"ruleId": "a", "patch": {"value": {"kind": "percentage", "percent": 30}, "id": "hijack"}},
                {"ruleId": "a", "patch": {"name": null}},
                {"ruleId": 5, "patch": {"enabled": false}},
                {"ruleId": "a", "patch": "x"}]}]}"#,
        )
        .unwrap();
        assert_eq!(config.campaigns.len(), 1);
        let campaign = &config.campaigns[0];
        assert_eq!(campaign.id.as_deref(), Some("bf"));
        assert_eq!(campaign.overrides.len(), 2);
        let fields = campaign.overrides.iter().fold(config.rules[0].fields.view(), |f, (_, p)| p.overlay(f));
        assert_eq!(*fields.value, ValueSpec::Percentage(30.0));
        assert_eq!(fields.name, "");
        assert!(fields.enabled);
        assert!(!campaign.overrides.iter().any(|(_, p)| p.retargets()));
    }
}
