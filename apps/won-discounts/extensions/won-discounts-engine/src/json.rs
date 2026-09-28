// Tolerant readers for the three `jsonValue` metafields and the line price
// (the `custom_scalar_overrides` in src/main.rs). JSON written by the sync or a
// merchant is DATA, not a contract the platform checks: every reader here
// accepts any JSON and reads what it does not understand as "nothing", exactly
// like the TS adapter and engine (`rec()`, `arr()`, `typeof … === "string"`).
// No reader ever returns an error: a failed `Deserialize` inside a generated
// accessor would abort the run instead of emitting no discount.

use shopify_function::wasm_api::{read::Error, Deserialize, Value};

use crate::engine::config::Config;
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

/// The product metafield `{ ruleIds, variantRuleIds?, outlet? }`. The variant
/// lookups stay lazy (a product may list hundreds of variants): only the cart
/// line's own variant is ever read, and only while the run's input is live.
#[derive(Clone)]
pub struct WonProduct {
    rule_ids: Option<Vec<String>>,
    variant_rule_ids: Option<Value>,
    outlet: Outlet,
}

impl Deserialize for WonProduct {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        let mut out = Self { rule_ids: None, variant_rule_ids: None, outlet: Outlet::None };
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
        Ok(out)
    }
}

impl WonProduct {
    /// Product-wide refs (`strings(won.ruleIds)`).
    pub fn rule_ids(&self) -> &[String] {
        self.rule_ids.as_deref().unwrap_or(&[])
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
    pub fn is_outlet(&self, variant_id: &str) -> bool {
        match self.outlet {
            Outlet::None => false,
            Outlet::All => true,
            Outlet::Variants(list) => {
                if variant_id.is_empty() {
                    return false;
                }
                let len = list.array_len().unwrap_or(0);
                (0..len).any(|i| list.get_at_index(i).as_string().as_deref() == Some(variant_id))
            }
        }
    }
}

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
                Ok((refs, w.is_outlet(variant)))
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
