// Tolerant readers for the four `jsonValue` metafields, the line price and the
// presentment currency rate (src/input.rs reads the input with them; they are
// also the `custom_scalar_overrides` of the typed input in src/main.rs). JSON
// written by the sync or a merchant is DATA, not a contract the platform checks:
// every reader here accepts any JSON and reads what it does not understand as
// "nothing", exactly like the TS adapter and engine (`rec()`, `arr()`,
// `typeof … === "string"`). No reader ever returns an error.

use std::cell::Cell;

use shopify_function::wasm_api::{read::Error, Deserialize, InternedStringId, Value};

use crate::engine::config::Config;
use crate::engine::table::Table;
use crate::engine::js;
use crate::engine::margin::MarginRef;

// --- Object keys, interned once per run ----------------------------------------------------
//
// A property read by its text makes the Wasm API copy the text into the input
// provider's memory on every call; an interned key is copied once per run and
// then read by its id (MVP 2 drift audit P1: ~20 property reads per cart line).
// `CachedInternedStringId` would hash the text (SipHash) on every read, so the
// ids live in a table indexed by `Key`, filled on first use. The provider keeps
// its interned strings for the whole run (and, natively, for the thread), and
// so does this table (thread-local: native tests run on several threads).

macro_rules! keys {
    ($($name:ident = $text:literal,)*) => {
        /// Every object key the function reads by name.
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum Key { $($name),* }
        const KEY_TEXTS: &[&str] = &[$($text),*];
        const KEY_COUNT: usize = KEY_TEXTS.len();
    };
}

keys! {
    // The input query (both targets).
    TriggeringDiscountCode = "triggeringDiscountCode",
    EnteredDiscountCodes = "enteredDiscountCodes",
    Code = "code",
    Discount = "discount",
    DiscountClasses = "discountClasses",
    Vars = "vars",
    JsonValue = "jsonValue",
    Shop = "shop",
    Config = "config",
    LocalTime = "localTime",
    Date = "date",
    CampaignActive = "campaignActive",
    Localization = "localization",
    Country = "country",
    IsoCode = "isoCode",
    Language = "language",
    PresentmentCurrencyRate = "presentmentCurrencyRate",
    Cart = "cart",
    Cost = "cost",
    SubtotalAmount = "subtotalAmount",
    CurrencyCode = "currencyCode",
    Lines = "lines",
    Id = "id",
    Quantity = "quantity",
    AmountPerQuantity = "amountPerQuantity",
    Amount = "amount",
    Gift = "gift",
    Value = "value",
    Merchandise = "merchandise",
    Product = "product",
    WonProduct = "wonProduct",
    WonVariant = "wonVariant",
    DeliveryGroups = "deliveryGroups",
    // Node variables.
    Role = "role",
    RuleId = "ruleId",
    CampaignId = "campaignId",
    VarsVersion = "varsVersion",
    // Product and variant metafields.
    RuleIds = "ruleIds",
    VariantRuleIds = "variantRuleIds",
    Outlet = "outlet",
    MarginRefs = "marginRefs",
    Cur = "cur",
    // The shared config.
    Modules = "modules",
    Codes = "codes",
    Rules = "rules",
    MarketCountries = "marketCountries",
    Campaigns = "campaigns",
    CampaignVarsVersion = "campaignVarsVersion",
    Engine = "engine",
    Combination = "combination",
    OutletWithAnything = "outletWithAnything",
    ProductWithOrder = "productWithOrder",
    ProductWithShipping = "productWithShipping",
    OrderWithShipping = "orderWithShipping",
    Margin = "margin",
    Method = "method",
    Schedule = "schedule",
    StartsOn = "startsOn",
    EndsOn = "endsOn",
    CodeHashes = "codeHashes",
    Priority = "priority",
    Enabled = "enabled",
    Name = "name",
    Kind = "kind",
    Percent = "percent",
    Target = "target",
    Minimum = "minimum",
    Subtotal = "subtotal",
    Scope = "scope",
    Targeting = "targeting",
    Markets = "markets",
    Segments = "segments",
    CombinesWith = "combinesWith",
    Overrides = "overrides",
    Patch = "patch",
    Killed = "killed",
    Max = "max",
    Min = "min",
    Col = "col",
}

thread_local! {
    static INTERNED: [Cell<Option<InternedStringId>>; KEY_COUNT] = const { [const { Cell::new(None) }; KEY_COUNT] };
}

impl Key {
    pub fn text(self) -> &'static str {
        KEY_TEXTS[self as usize]
    }

    /// The key's interned id (interned on first use).
    #[inline]
    fn id(self, value: &Value) -> InternedStringId {
        INTERNED.with(|ids| {
            let slot = &ids[self as usize];
            slot.get().unwrap_or_else(|| {
                let id = value.intern_utf8_str(self.text());
                slot.set(Some(id));
                id
            })
        })
    }
}

// --- Low-level reads (JS `typeof` checks) ------------------------------------------------

/// `obj[key]` for a record; anything else reads as `undefined` (an error value),
/// exactly as a read by the key's text would.
#[inline]
pub fn prop(value: &Value, key: Key) -> Value {
    value.get_interned_obj_prop(key.id(value))
}

/// An object read key by key, counting the keys that held something: once every
/// key the object has was found, any other name is known to be absent and reads
/// as nothing without a call into the input provider. (A key holding null reads
/// like an absent one, so it never ends the search early.) `get` is `obj[key]`
/// with `None` for a key known to be absent — read it like null.
pub struct Fields {
    value: Value,
    left: usize,
}

impl Fields {
    /// For an object (anything else has no fields).
    pub fn new(value: &Value) -> Self {
        Self { value: *value, left: if value.is_obj() { value.obj_len().unwrap_or(usize::MAX) } else { 0 } }
    }

    pub fn get(&mut self, key: Key) -> Option<Value> {
        if self.left == 0 {
            return None;
        }
        let v = prop(&self.value, key);
        if !v.is_null() {
            self.left -= 1;
        }
        Some(v)
    }
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
    Some(strings_of(value, value.array_len()?))
}

/// `strings` of an array of `len` elements.
fn strings_of(value: &Value, len: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        if let Some(s) = value.get_at_index(i).as_string() {
            out.push(s);
        }
    }
    out
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

/// `obj[key]` for a record (`record`) or an array (an array's own numeric keys).
fn own_value(value: &Value, record: bool, key: &str) -> Value {
    if !record {
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
        Ok(Self::read(value))
    }
}

impl NodeVars {
    pub fn read(value: &Value) -> Self {
        if !value.is_obj() {
            return Self::default();
        }
        Self {
            role: string(&prop(value, Key::Role)),
            rule_id: non_empty(&prop(value, Key::RuleId)),
            campaign_id: non_empty(&prop(value, Key::CampaignId)),
            vars_version: non_empty(&prop(value, Key::VarsVersion)),
        }
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
/// live; `marginRefs` is looked up only while margin protection has collection
/// settings (src/input.rs).
#[derive(Clone)]
pub struct WonProduct {
    rule_ids: Option<Vec<String>>,
    /// `variantRuleIds` when a record (true) or an array (false).
    variant_rule_ids: Option<(Value, bool)>,
    outlet: Outlet,
    /// `marginRefs` when an array, with its length.
    margin_refs: Option<(Value, usize)>,
}

impl Deserialize for WonProduct {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        Ok(Self::read(value, true))
    }
}

impl WonProduct {
    /// The metafield value (`marginRefs` looked up only when `with_margin_refs`).
    /// Keys are looked up by name, each costing a read of the input; once as many
    /// keys held something as the object has, the rest are known to be absent
    /// (a key that holds null reads like an absent one, so it never ends the
    /// search early). The common values — `{ruleIds}`, with margin protection
    /// `{ruleIds, marginRefs}`, and either with `variantRuleIds` — are read with
    /// no lookup of a key they do not have.
    pub fn read(value: &Value, with_margin_refs: bool) -> Self {
        let mut out = Self { rule_ids: None, variant_rule_ids: None, outlet: Outlet::None, margin_refs: None };
        // `typeof won === "object"` also admits arrays, whose `.ruleIds` etc. are undefined.
        let Some(keys) = value.obj_len() else { return out };
        // An array or a record is a key that held something; anything else is
        // checked for null (each check decodes the value: the common shapes decode
        // each value once).
        let held = |v: &Value| usize::from(!v.is_null());
        let mut found = 0;
        let rule_ids = prop(value, Key::RuleIds);
        match rule_ids.array_len() {
            Some(len) => {
                found += 1;
                out.rule_ids = Some(strings_of(&rule_ids, len));
            }
            None => found += held(&rule_ids),
        }
        if with_margin_refs && found < keys {
            let refs = prop(value, Key::MarginRefs);
            match refs.array_len() {
                Some(len) => {
                    found += 1;
                    out.margin_refs = Some((refs, len));
                }
                None => found += held(&refs),
            }
        }
        if found >= keys {
            return out;
        }
        let by_variant = prop(value, Key::VariantRuleIds);
        if by_variant.is_obj() {
            found += 1;
            out.variant_rule_ids = Some((by_variant, true));
        } else if by_variant.is_array() {
            found += 1;
            out.variant_rule_ids = Some((by_variant, false));
        } else {
            found += held(&by_variant);
        }
        if found >= keys {
            return out;
        }
        let outlet = prop(value, Key::Outlet);
        if is_true(&outlet) {
            out.outlet = Outlet::All;
        } else if outlet.is_array() {
            out.outlet = Outlet::Variants(outlet);
        }
        out
    }

    /// Product-wide refs (`strings(won.ruleIds)`).
    pub fn rule_ids(&self) -> &[String] {
        self.rule_ids.as_deref().unwrap_or(&[])
    }

    /// The product-wide refs, moved out.
    pub fn take_rule_ids(&mut self) -> Vec<String> {
        self.rule_ids.take().unwrap_or_default()
    }

    /// `strings(won.marginRefs)` (normalizeCart): the numeric ids of the product's
    /// decisive margin collections (margin protection, MVP 2), each read into a
    /// number (MarginRef) — its text is not kept.
    pub fn margin_refs(&self) -> Vec<MarginRef> {
        let Some((refs, len)) = self.margin_refs else { return Vec::new() };
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            if let Some(text) = refs.get_at_index(i).as_string() {
                out.push(MarginRef::from(text));
            }
        }
        out
    }

    /// Whether the variant's id is needed at all (variant refs or an outlet list):
    /// otherwise the line's variant id is never read.
    pub fn needs_variant_id(&self) -> bool {
        self.variant_rule_ids.is_some() || matches!(self.outlet, Outlet::Variants(_))
    }

    /// `refsOfVariant` (cart.ts): this variant's refs, by its numeric id, else by
    /// its full GID; a sibling variant's refs never apply.
    pub fn variant_refs(&self, variant_id: &str) -> Vec<String> {
        let Some((map, record)) = self.variant_rule_ids else { return Vec::new() };
        if variant_id.is_empty() {
            return Vec::new();
        }
        let key = variant_key(variant_id);
        let by_key = own_value(&map, record, key);
        // An array is an own value (neither null nor undefined): the common entry.
        if let Some(len) = by_key.array_len() {
            return strings_of(&by_key, len);
        }
        if !by_key.is_null() && has_own_fast(&map, key, &by_key) {
            return Vec::new();
        }
        // The key is absent or explicitly null. Either way null reads as [], so
        // only a present full-GID entry needs the (rare) own-key check.
        let by_gid = own_value(&map, record, variant_id);
        if by_gid.is_null() || !has_own_fast(&map, variant_id, &by_gid) || has_own(&map, key) {
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
pub struct OutletLists(Table<(usize, String), Option<Vec<String>>>);

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
    // A byte search ('/' is ASCII, so it never splits a character).
    match variant_id.as_bytes().iter().rposition(|&b| b == b'/') {
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
        Ok(Self::read(value))
    }
}

impl WonVariant {
    /// (Anything but a record reads `cost` as undefined: not a number, no cost.)
    pub fn read(value: &Value) -> Self {
        let cost = number(&prop(value, Key::Cost));
        let cur = if cost.is_some_and(|c| c > 0.0) { string(&prop(value, Key::Cur)) } else { None };
        Self { cost, cur }
    }
}

// --- Presentment currency rate (`presentmentCurrencyRate`, a Decimal) --------------------------

/// `decimalNumber` (tests/reference-adapter.js): a number as it is; a string
/// only as plain decimal digits after JS `trim` (`^\d+(\.\d+)?$`), truncated to
/// its first 15 significant digits (the rest dropped toward zero: an error below
/// 10⁻¹⁴ relative, far below ceilTol's tolerance), read as `Number(text)` of
/// that; anything else none. Never fails (the generated `Decimal` would abort
/// the run on junk).
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct DecimalNumber(pub Option<f64>);

/// 10^0 … 10^22: every one exactly representable in an f64.
const POW10: [f64; 23] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

/// A plain decimal text → `Number(text truncated to 15 significant digits)`,
/// without float-parsing tables (the Wasm size limit): the kept digits w
/// (< 10^15 < 2^53) and 10^k (k ≤ 22) are exact f64s, so w / 10^k (or w × 10^k
/// when integer digits were dropped) is ONE correctly rounded operation — the
/// nearest f64 to that decimal, exactly what `Number` gives (Clinger's fast
/// path). More than 22 decimals, or 22 integer digits, after the cut → none (a
/// rate below 10⁻⁷ or above 10³⁶ is not a currency rate).
fn decimal_number(text: &str) -> Option<f64> {
    const SIGNIFICANT: usize = 15;
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) if digits(fraction) => (whole.as_bytes(), fraction.as_bytes()),
        Some(_) => return None,
        None => (text.as_bytes(), &[][..]),
    };
    if !digits(std::str::from_utf8(whole).unwrap_or("")) {
        return None;
    }
    let total = whole.len() + fraction.len();
    let digit = |i: usize| if i < whole.len() { whole[i] } else { fraction[i - whole.len()] };
    let Some(first) = (0..total).find(|&i| digit(i) != b'0') else { return Some(0.0) };
    let end = total.min(first + SIGNIFICANT);
    let mut w: u64 = 0;
    for i in first..end {
        w = w * 10 + u64::from(digit(i) - b'0');
    }
    if end <= whole.len() {
        let dropped = whole.len() - end;
        return (dropped <= 22).then(|| w as f64 * POW10[dropped]);
    }
    let mut decimals = end - whole.len();
    while decimals > 0 && digit(whole.len() + decimals - 1) == b'0' {
        decimals -= 1;
        w /= 10;
    }
    (decimals <= 22).then(|| w as f64 / POW10[decimals])
}

impl Deserialize for DecimalNumber {
    fn deserialize(value: &Value) -> Result<Self, Error> {
        Ok(Self::read(value))
    }
}

impl DecimalNumber {
    pub fn read(value: &Value) -> Self {
        if let Some(text) = value.as_string() {
            return Self(decimal_number(js::trim(&text)));
        }
        Self(number(value))
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
        Ok(Self::read(value))
    }
}

impl DecimalText {
    pub fn read(value: &Value) -> Self {
        if let Some(text) = value.as_string() {
            return Self(Some(text));
        }
        Self(value.as_number().filter(|n| n.is_finite()).map(js::number_to_string))
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
        let margin_refs = |json: &str| {
            let read = run_function_with_input(|w: WonProduct| Ok(w.margin_refs()), json).unwrap();
            read.into_iter()
                .map(|r| match r {
                    MarginRef::Id(n) => n.to_string(),
                    MarginRef::Text(t) => t,
                })
                .collect::<Vec<_>>()
        };
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
        assert_eq!(rate(r#""0.000""#), Some(0.0));
        for junk in [r#""1e3""#, r#""-1""#, r#""""#, r#""0x10""#, r#""1.""#, r#"".5""#, "true", "null"] {
            assert_eq!(rate(junk), None, "{junk}");
        }
        // More than 15 significant digits: the first 15, the rest dropped (toward zero).
        assert_eq!(rate(r#""0.0400000000000000012345""#), Some(0.04));
        assert_eq!(rate(r#""0.12345678901234567""#), Some(0.123456789012345));
        assert_eq!(rate(r#""25.123456789012345678""#), Some(25.1234567890123));
        assert_eq!(rate(r#""1234567890123456""#), Some(1_234_567_890_123_450.0));
        assert_eq!(rate(r#""12345678901234567890123""#), Some(12_345_678_901_234_500_000_000.0));
        // Beyond 22 decimals or 22 dropped integer digits after the cut: not a rate.
        assert_eq!(rate(r#""0.00000000000000000000001""#), None);
        assert_eq!(rate(&format!(r#""1{}""#, "0".repeat(40))), None);
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
