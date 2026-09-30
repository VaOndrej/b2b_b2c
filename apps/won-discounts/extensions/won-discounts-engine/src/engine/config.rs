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

use super::js;
use super::margin::{read_margin_payload, MarginPayload};
use crate::json::{entries, is_true, non_empty, number, prop, string, string_list, Fields, Key};

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

fn read_targeting(value: &Value) -> Targeting {
    if !value.is_obj() {
        return Targeting::default();
    }
    Targeting {
        markets: string_list(&prop(value, Key::Markets)),
        segment_targeted: string_list(&prop(value, Key::Segments)).is_some(),
    }
}

fn read_combines(value: &Value) -> Vec<String> {
    if !value.is_obj() {
        return Vec::new();
    }
    string_list(&prop(value, Key::RuleIds)).unwrap_or_default()
}


fn read_patch(patch: &Value, cur: Option<&str>) -> RulePatch {
    let mut out = RulePatch::default();
    for (key, value) in entries(patch) {
        match key.as_str() {
            "enabled" => out.enabled = Some(is_true(&value)),
            "name" => out.name = Some(string(&value).unwrap_or_default()),
            "value" => out.value = Some(read_value(&value, cur)),
            "target" => out.target = Some(read_target(&value)),
            "minimum" => out.minimum = Some(read_minimum(&value, cur)),
            "targeting" => out.targeting = Some(read_targeting(&value)),
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
fn read_rule(raw: &Value, cur: Option<&str>) -> Option<RawRule> {
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
    let targeting = f.get(Key::Targeting).map_or_else(Targeting::default, |v| read_targeting(&v));
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

fn read_campaign(value: &Value, cur: Option<&str>) -> Option<RawCampaign> {
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
            overrides.push((rule_id, read_patch(&patch, cur)));
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
        Self::read_in(value, None)
    }

    /// `read` for a cart in currency `cur` (the function run): money is read in
    /// that currency only (`read_money`), the one plan.rs looks up.
    pub fn read_in(value: &Value, cur: Option<&str>) -> Option<Config> {
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

        let mut market_countries = Vec::new();
        for (handle, countries) in entries(&prop(value, Key::MarketCountries)) {
            if let Some(list) = string_list(&countries) {
                market_countries.retain(|(h, _): &(String, Vec<String>)| *h != handle);
                market_countries.push((handle, list.iter().map(|c| js::upper(c)).collect()));
            }
        }
        let campaigns_value = prop(value, Key::Campaigns);
        let campaigns =
            (0..campaigns_value.array_len().unwrap_or(0)).filter_map(|i| read_campaign(&campaigns_value.get_at_index(i), cur)).collect();

        Some(Config {
            campaign_id: string(&prop(value, Key::CampaignId)),
            campaign_vars_version: string(&prop(value, Key::CampaignVarsVersion)),
            engine: read_engine(value),
            market_countries,
            rules: (0..rule_count).filter_map(|i| read_rule(&rules.get_at_index(i), cur)).collect(),
            campaigns,
            margin: read_margin_payload(&prop(&modules, Key::Margin)),
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
