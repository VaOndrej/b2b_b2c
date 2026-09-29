// Tolerant readers for the four `jsonValue` metafields, the line price and the
// presentment currency rate (the `custom_scalar_overrides` in src/main.rs). JSON written by the sync or a
// merchant is DATA, not a contract the platform checks: every reader here
// accepts any JSON and reads what it does not understand as "nothing", exactly
// like the TS adapter and engine (`rec()`, `arr()`, `typeof … === "string"`).
// No reader ever returns an error: a failed `Deserialize` inside a generated
// accessor would abort the run instead of emitting no discount.

use shopify_function::wasm_api::{read::Error, Deserialize, Value};

use crate::engine::config::Config;
use crate::engine::fnv::FnvMap;
use crate::engine::js;

// --- Low-level reads (JS `typeof` checks) ------------------------------------------------

/// `obj[key]` for a record; anything else reads as `undefined` (an error value).
/// (Plain keys on purpose: `CachedInternedStringId::load` hashes the key with
/// SipHash on every call, which measured slower than copying a short key.)
pub fn prop(value: &Value, key: &str) -> Value {
    value.get_obj_prop(key)
}

/// `typeof v === "string" ? v : null`.
pub fn string(value: &Value) -> Option<String> {
    value.as_string()
}

/// `typeof v === "string" && v !== "" ? v : null` (adapter `nonEmpty`).
pub fn non_empty(value: &Value) -> Option<String> {
    value.as_string().filter(|s| !s.is_empty())
}

/// `v === true`.
pub fn is_true(value: &Value) -> bool {
    value.as_bool() == Some(true)
}

/// `typeof v === "number" && Number.isFinite(v) ? v : null` (JSON has no NaN/∞).
pub fn number(value: &Value) -> Option<f64> {
    value.as_number().filter(|n| n.is_finite())
}

/// `Array.isArray(v) ? v.filter(x => typeof x === "string") : null`.
pub fn strings(value: &Value) -> Option<Vec<String>> {
    let len = value.array_len()?;
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        if let Some(s) = value.get_at_index(i).as_string() {
            out.push(s);
        }
    }
    Some(out)
}

/// `stringList` (plan.ts): the strings of an array, or null when there are none.
pub fn string_list(value: &Value) -> Option<Vec<String>> {
    strings(value).filter(|list| !list.is_empty())
}

/// `Object.keys(v)` of a record (in JSON order), with each key's value.
pub fn entries(value: &Value) -> Vec<(String, Value)> {
    let Some(len) = value.obj_len() else { return Vec::new() };
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        if let Some(key) = value.get_obj_key_at_index(i) {
            out.push((key, value.get_at_index(i)));
        }
    }
    out
}

/// `Object.prototype.hasOwnProperty.call(v, key)` for a JSON record or array.
pub fn has_own(value: &Value, key: &str) -> bool {
    if value.is_obj() {
        let Some(len) = value.obj_len() else { return false };
        return (0..len).any(|i| value.get_obj_key_at_index(i).as_deref() == Some(key));
    }
    if let Some(len) = value.array_len() {
        return key == "length" || array_index(key).is_some_and(|i| i < len);
    }
    false
}

/// A canonical array index (`"0"`, `"42"`; not `"042"`, `"-1"`, `"4.0"`).
fn array_index(key: &str) -> Option<usize> {
    let b = key.as_bytes();
    if b.is_empty() || !b.iter().all(u8::is_ascii_digit) || (b.len() > 1 && b[0] == b'0') {
        return None;
    }
    key.parse::<u32>().ok().filter(|i| *i < u32::MAX).map(|i| i as usize)
}

/// `obj[key]` for a record or an array (an array's own numeric keys).
fn own_value(value: &Value, key: &str) -> Value {
    if value.is_array() {
        return match array_index(key) {
            Some(i) if value.array_len().is_some_and(|len| i < len) => value.get_at_index(i),
            // `length` (a number) and anything else: not a list of strings.
            _ => value.get_obj_prop(key),
        };
    }
    value.get_obj_prop(key)
}

// --- Node variables (`discount.vars`, @won/core buildNodeVars) -------------------------------

/// The node's `function_vars` as the adapter reads them (`rec(vars)`).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct NodeVars {
    /// `vars.role` when it is a string.
    pub role: Option<String>,
    /// `nonEmpty(vars.ruleId)`.
    pub rule_id: Option<String>,
    /// `nonEmpty(vars.campaignId)`.
    pub campaign_id: Option<String>,
    /// `nonEmpty(vars.varsVersion)`.
    pub vars_version: Option<String>,
}

impl Deserialize for NodeVars {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        if !value.is_obj() {
            return Ok(Self::default());
        }
        Ok(Self {
            role: string(&prop(value, "role")),
            rule_id: non_empty(&prop(value, "ruleId")),
            campaign_id: non_empty(&prop(value, "campaignId")),
            vars_version: non_empty(&prop(value, "varsVersion")),
        })
    }
}

// --- Shared config (`shop.config`, @won/core buildShopFunctionConfig) -------------------------

/// The shop's shared config; `None` = not the shape `planCart` accepts
/// (`isFunctionConfigPayload`), e.g. over 10 000 B it arrives as null (C7).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ShopConfig(pub Option<Config>);

impl Deserialize for ShopConfig {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        Ok(Self(Config::read(value)))
    }
}

// --- Product targeting (`wonProduct`, targeting.ts productMetafieldValue) ------------------

#[derive(Clone, Copy)]
enum Outlet {
    None,
    /// `outlet: true`: every variant of the product.
    All,
    /// `outlet: [variant GIDs]`, read lazily for the line's variant.
    Variants(Value),
}

/// The product metafield `{ ruleIds, variantRuleIds?, outlet?, marginRefs? }`.
/// The variant lookups stay lazy (a product may list hundreds of variants): only
/// the cart line's own variant is ever read, and only while the run's input is
/// live; `marginRefs` is read only while margin protection is on.
#[derive(Clone)]
pub struct WonProduct {
    rule_ids: Option<Vec<String>>,
    variant_rule_ids: Option<Value>,
    outlet: Outlet,
    margin_refs: Option<Value>,
}

impl Deserialize for WonProduct {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        let mut out = Self { rule_ids: None, variant_rule_ids: None, outlet: Outlet::None, margin_refs: None };
        // `typeof won === "object"` also admits arrays, whose `.ruleIds` etc. are undefined.
        if !value.is_obj() {
            return Ok(out);
        }
        let rule_ids = prop(value, "ruleIds");
        out.rule_ids = strings(&rule_ids);
        // The common value is `{ruleIds}` alone: then there is nothing else to look up.
        if value.obj_len() == Some(1) && !rule_ids.is_null() {
            return Ok(out);
        }
        let by_variant = prop(value, "variantRuleIds");
        if by_variant.is_obj() || by_variant.is_array() {
            out.variant_rule_ids = Some(by_variant);
        }
        let outlet = prop(value, "outlet");
        if is_true(&outlet) {
            out.outlet = Outlet::All;
        } else if outlet.is_array() {
            out.outlet = Outlet::Variants(outlet);
        }
        let margin_refs = prop(value, "marginRefs");
        if margin_refs.is_array() {
            out.margin_refs = Some(margin_refs);
        }
        Ok(out)
    }
}

impl WonProduct {
    /// Product-wide refs (`strings(won.ruleIds)`).
    pub fn rule_ids(&self) -> &[String] {
        self.rule_ids.as_deref().unwrap_or(&[])
    }

    /// `strings(won.marginRefs)` (normalizeCart): the numeric ids of the product's
    /// collections with a margin setting (margin protection, MVP 2).
    pub fn margin_refs(&self) -> Vec<String> {
        self.margin_refs.as_ref().and_then(strings).unwrap_or_default()
    }

    /// Whether the variant's id is needed at all (variant refs or an outlet list):
    /// otherwise the line's variant id is never read.
    pub fn needs_variant_id(&self) -> bool {
        self.variant_rule_ids.is_some() || matches!(self.outlet, Outlet::Variants(_))
    }

    /// `refsOfVariant` (cart.ts): this variant's refs, by its numeric id, else by
    /// its full GID; a sibling variant's refs never apply.
    pub fn variant_refs(&self, variant_id: &str) -> Vec<String> {
        let Some(map) = self.variant_rule_ids.as_ref() else { return Vec::new() };
        if variant_id.is_empty() {
            return Vec::new();
        }
        let key = variant_key(variant_id);
        let by_key = own_value(map, key);
        if !by_key.is_null() && has_own_fast(map, key, &by_key) {
            return strings(&by_key).unwrap_or_default();
        }
        // The key is absent or explicitly null. Either way null reads as [], so
        // only a present full-GID entry needs the (rare) own-key check.
        let by_gid = own_value(map, variant_id);
        if by_gid.is_null() || !has_own_fast(map, variant_id, &by_gid) || has_own(map, key) {
            return Vec::new();
        }
        strings(&by_gid).unwrap_or_default()
    }

    /// `outlet === true || (Array.isArray(outlet) && variantId !== "" && outlet.includes(variantId))`.
    ///
    /// A variant outlet list is read in full at most once per run: every line of
    /// one product carries the same list (the product metafield). The first line
    /// of a product scans it (stopping at a match), the second parses and sorts
    /// it into `lists`, and later lines only read its first element to find it.
    /// Two lists are taken to be the same list when their length and first
    /// element agree — always true for what the sync writes (a product's own
    /// variant GIDs; a variant belongs to one product); README "Accepted edge
    /// differences" for hand-made metafields.
    pub fn is_outlet(&self, variant_id: &str, lists: &mut OutletLists) -> bool {
        match self.outlet {
            Outlet::None => false,
            Outlet::All => true,
            Outlet::Variants(list) => {
                let len = list.array_len().unwrap_or(0);
                if variant_id.is_empty() || len == 0 {
                    return false;
                }
                let Some(first) = list.get_at_index(0).as_string() else {
                    // Not a list of GIDs: read it as it is, once for this line.
                    return (1..len).any(|i| list.get_at_index(i).as_string().as_deref() == Some(variant_id));
                };
                let key = (len, first);
                match lists.0.get_mut(&key) {
                    // Third and later lines of this product: a lookup.
                    Some(Some(sorted)) => sorted.binary_search_by(|v| v.as_str().cmp(variant_id)).is_ok(),
                    // Second line of this product: read the whole list once, keep it sorted.
                    Some(slot @ None) => {
                        let mut sorted: Vec<String> = Vec::with_capacity(len);
                        sorted.push(key.1.clone());
                        sorted.extend((1..len).filter_map(|i| list.get_at_index(i).as_string()));
                        sorted.sort_unstable();
                        let hit = sorted.binary_search_by(|v| v.as_str().cmp(variant_id)).is_ok();
                        *slot = Some(sorted);
                        hit
                    }
                    // First line of this product: scan, stopping at a match.
                    None => {
                        let hit =
                            key.1 == variant_id || (1..len).any(|i| list.get_at_index(i).as_string().as_deref() == Some(variant_id));
                        lists.0.insert(key, None);
                        hit
                    }
                }
            }
        }
    }
}

/// The variant outlet lists seen so far in this run, by (length, first element):
/// none after the first line of a product, the sorted list from its second line on.
#[derive(Default)]
pub struct OutletLists(FnvMap<(usize, String), Option<Vec<String>>>);

/// A value read by key is "own" when it is not undefined: for a record the
/// provider returns null for a missing key and an error for a non-record, so
/// only an error (e.g. an array's non-index key) needs the slow check.
fn has_own_fast(map: &Value, key: &str, found: &Value) -> bool {
    if found.as_error().is_some() {
        return has_own(map, key);
    }
    true
}

/// `variantKey` (cart.ts): the tail of a GID (`gid://shopify/ProductVariant/42` → "42").
pub fn variant_key(variant_id: &str) -> &str {
    match variant_id.rfind('/') {
        Some(slash) => &variant_id[slash + 1..],
        None => variant_id,
    }
}

// --- Variant cost (`wonVariant`, margin protection MVP 2) -------------------------------------

/// The variant metafield `$app:won_discounts`/`variant` = `{cost, cur}`, as the
/// adapter passes it on and normalizeCart keeps it: `cost` when a number (MAJOR
/// units of the shop currency), `cur` when a string. Whether the cost is usable
/// is margin.rs's call (> 0, `cur` = the shop currency); `cur` is read only for
/// a cost margin.rs could use (a number > 0), since nothing else looks at it.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct WonVariant {
    pub cost: Option<f64>,
    pub cur: Option<String>,
}

impl Deserialize for WonVariant {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        if !value.is_obj() {
            return Ok(Self::default());
        }
        let cost = number(&prop(value, "cost"));
        let cur = if cost.is_some_and(|c| c > 0.0) { string(&prop(value, "cur")) } else { None };
        Ok(Self { cost, cur })
    }
}

// --- Presentment currency rate (`presentmentCurrencyRate`, a Decimal) --------------------------

/// `decimalNumber` (tests/reference-adapter.js): a number as it is; a string
/// only as plain decimal digits after JS `trim` (`^\d+(\.\d+)?$`) with at most
/// 15 significant digits and at most 22 decimals (zeros that change nothing not
/// counted), read as `Number(text)`; anything else none. Never fails (the
/// generated `Decimal` would abort the run on junk).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct DecimalNumber(pub Option<f64>);

/// 10^0 … 10^22: every one exactly representable in an f64.
const POW10: [f64; 23] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

/// A plain decimal text → `Number(text)`, without float-parsing tables (the Wasm
/// size limit): its digits w (< 10^15 < 2^53) and 10^k (k ≤ 22) are exact f64s,
/// so w / 10^k is ONE correctly rounded division — the nearest f64 to the
/// decimal, exactly what `Number(text)` gives (Clinger's fast path). Longer or
/// malformed text → none.
fn decimal_number(text: &str) -> Option<f64> {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) if digits(fraction) => (whole, fraction.trim_end_matches('0')),
        Some(_) => return None,
        None => (text, ""),
    };
    if !digits(whole) || fraction.len() > 22 {
        return None;
    }
    let mut w: u64 = 0;
    let mut significant = 0;
    for b in whole.bytes().chain(fraction.bytes()) {
        if w == 0 && b == b'0' {
            continue; // a leading zero
        }
        significant += 1;
        if significant > 15 {
            return None;
        }
        w = w * 10 + u64::from(b - b'0');
    }
    Some(w as f64 / POW10[fraction.len()])
}

impl Deserialize for DecimalNumber {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        if let Some(text) = value.as_string() {
            return Ok(Self(decimal_number(js::trim(&text))));
        }
        Ok(Self(number(value)))
    }
}

// --- Line price (`amountPerQuantity.amount`, a Decimal) -------------------------------------

/// The line's unit price as text, for money.rs `to_minor_units` (parsed from its
/// digits, never through a float). Shopify sends a string; a number (local
/// runner input) is read as `String(n)`, anything else as no price.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DecimalText(Option<String>);

impl DecimalText {
    /// `String(amount).trim()` (toMinorUnits), when the amount is a string or a number.
    pub fn text(&self) -> Option<&str> {
        self.0.as_deref().map(js::trim)
    }
}

impl Deserialize for DecimalText {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        if let Some(text) = value.as_string() {
            return Ok(Self(Some(text)));
        }
        Ok(Self(value.as_number().filter(|n| n.is_finite()).map(js::number_to_string)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shopify_function::run_function_with_input;

    const V: &str = "gid://shopify/ProductVariant/42";

    /// (product-wide + variant refs, outlet) for variant 42, as normalizeCart sees them.
    fn line_refs(won: &str) -> (Vec<String>, bool) {
        run_function_with_input(
            |w: WonProduct| {
                let variant = if w.needs_variant_id() { V } else { "" };
                let mut refs = w.rule_ids().to_vec();
                refs.extend(w.variant_refs(variant));
                Ok((refs, w.is_outlet(variant, &mut OutletLists::default())))
            },
            won,
        )
        .unwrap()
    }

    fn refs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn product_metafield_reads_like_the_ts_adapter_and_normalize_cart() {
        // Each expectation is the TS reference (adaptInput + normalizeCart) on the same value.
        assert_eq!(line_refs(r#"{"ruleIds": ["a"], "variantRuleIds": {"42": ["v"]}}"#), (refs(&["a", "v"]), false));
        assert_eq!(line_refs(&format!(r#"{{"variantRuleIds": {{"{V}": ["g"]}}}}"#)), (refs(&["g"]), false));
        assert_eq!(line_refs(&format!(r#"{{"variantRuleIds": {{"42": null, "{V}": ["g"]}}}}"#)), (vec![], false));
        assert_eq!(line_refs(r#"{"variantRuleIds": {"42": "x"}}"#), (vec![], false));
        assert_eq!(line_refs(r#"{"variantRuleIds": {"43": ["x"]}}"#), (vec![], false));
        let mut array = vec!["null"; 42];
        array.push(r#"["arr"]"#);
        assert_eq!(line_refs(&format!(r#"{{"variantRuleIds": [{}]}}"#, array.join(","))), (refs(&["arr"]), false));
        assert_eq!(line_refs(r#"{"ruleIds": ["a"], "outlet": true}"#), (refs(&["a"]), true));
        assert_eq!(line_refs(&format!(r#"{{"outlet": ["{V}"]}}"#)), (vec![], true));
        assert_eq!(line_refs(r#"{"outlet": ["gid://shopify/ProductVariant/43"]}"#), (vec![], false));
        assert_eq!(line_refs(r#"{"ruleIds": "x"}"#), (vec![], false));
        assert_eq!(line_refs(r#"[["a"]]"#), (vec![], false));
        assert_eq!(line_refs(r#"{"ruleIds": ["a", 1, null, "b"]}"#), (refs(&["a", "b"]), false));
        assert_eq!(line_refs("null"), (vec![], false));
    }

    #[test]
    fn outlet_lists_are_read_once_per_product_and_answer_every_line() {
        // Four lines of product A (variants 1–4, outlet list [2, 4]) and one of
        // product B (outlet list [1]): scan, parse, lookup, lookup; then B's own list.
        let json = r#"[
            {"outlet": ["gid://v/2", "gid://v/4"]}, {"outlet": ["gid://v/2", "gid://v/4"]},
            {"outlet": ["gid://v/2", "gid://v/4"]}, {"outlet": ["gid://v/2", "gid://v/4"]},
            {"outlet": ["gid://w/1"]}
        ]"#;
        let got = run_function_with_input(
            |products: Vec<WonProduct>| {
                let mut lists = OutletLists::default();
                let variants = ["gid://v/1", "gid://v/2", "gid://v/3", "gid://v/4", "gid://w/1"];
                Ok(products.iter().zip(variants).map(|(w, v)| w.is_outlet(v, &mut lists)).collect::<Vec<_>>())
            },
            json,
        )
        .unwrap();
        assert_eq!(got, vec![false, true, false, true, true]);
    }

    #[test]
    fn the_variant_cost_the_margin_refs_and_the_rate_read_like_the_ts_adapter() {
        // Each expectation is the TS reference (adaptInput + normalizeCart) on the same value.
        let cost = |json: &str| run_function_with_input(|v: WonVariant| Ok((v.cost, v.cur)), json).unwrap();
        assert_eq!(cost(r#"{"cost": 12.5, "cur": "CZK"}"#), (Some(12.5), Some("CZK".to_string())));
        assert_eq!(cost(r#"{"cost": "5", "cur": 7}"#), (None, None));
        // Read as is: the engine decides (a lower-case currency → unknown); a cost it
        // cannot use (≤ 0) skips `cur`, which nothing else reads.
        assert_eq!(cost(r#"{"cost": 3, "cur": "czk"}"#), (Some(3.0), Some("czk".to_string())));
        assert_eq!(cost(r#"{"cost": -3, "cur": "czk"}"#), (Some(-3.0), None));
        assert_eq!(cost("[1]"), (None, None));
        assert_eq!(cost("null"), (None, None));
        let margin_refs = |json: &str| run_function_with_input(|w: WonProduct| Ok(w.margin_refs()), json).unwrap();
        assert_eq!(margin_refs(r#"{"ruleIds": ["a"], "marginRefs": ["1", 2, "3"]}"#), refs(&["1", "3"]));
        assert_eq!(margin_refs(r#"{"marginRefs": ["7"]}"#), refs(&["7"]));
        assert_eq!(margin_refs(r#"{"marginRefs": "1"}"#), refs(&[]));
        assert_eq!(margin_refs(r#"{"ruleIds": ["a"]}"#), refs(&[]));
        let rate = |json: &str| run_function_with_input(|d: DecimalNumber| Ok(d.0), json).unwrap();
        assert_eq!(rate(r#""0.04""#), Some(0.04));
        assert_eq!(rate(r#"" 25.1 ""#), Some(25.1));
        assert_eq!(rate("7"), Some(7.0));
        // Number(text) exactly: the nearest f64, zeros that change nothing ignored.
        assert_eq!(rate(r#""0.3""#), Some(0.3));
        assert_eq!(rate(r#""0.0405000""#), Some(0.0405));
        assert_eq!(rate(r#""000123.4500""#), Some(123.45));
        assert_eq!(rate(r#""123456789012345""#), Some(123_456_789_012_345.0));
        assert_eq!(rate(r#""0.0000000000000000000001""#), Some(1e-22));
        for junk in [r#""1e3""#, r#""-1""#, r#""""#, r#""0x10""#, r#""1.""#, r#"".5""#, "true", "null"] {
            assert_eq!(rate(junk), None, "{junk}");
        }
        // Beyond 15 significant digits or 22 decimals: not read (the cost then counts as unknown).
        assert_eq!(rate(r#""1234567890123456""#), None);
        assert_eq!(rate(r#""0.00000000000000000000001""#), None);
    }

    #[test]
    fn node_vars_and_prices_never_fail() {
        let vars = run_function_with_input(|v: NodeVars| Ok(v), r#"{"role": "code", "ruleId": "", "varsVersion": 7}"#).unwrap();
        assert_eq!(vars, NodeVars { role: Some("code".into()), ..NodeVars::default() });
        let junk = run_function_with_input(|v: NodeVars| Ok(v), "[1, 2]").unwrap();
        assert_eq!(junk, NodeVars::default());
        let price = |json: &str| run_function_with_input(|d: DecimalText| Ok(d.text().map(str::to_string)), json).unwrap();
        assert_eq!(price(r#"" 12.50 ""#), Some("12.50".to_string()));
        assert_eq!(price("12.5"), Some("12.5".to_string()));
        assert_eq!(price("true"), None);
    }
}
