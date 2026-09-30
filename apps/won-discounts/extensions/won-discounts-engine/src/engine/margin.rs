// margin.ts (@won/core): margin protection's arithmetic and the compact margin
// payload of the shop config, ported 1:1 (MVP 2, spec §3 bod 7, A1.7 + A2).
// Every float expression is evaluated in the TS order, so a floor is bit for
// bit the TS floor:
//   cost known    floorUnit = ceilTol(costMinor / (1 − m / 100)),  m ∈ [0, 95]
//   cost unknown  floorUnit = ceilTol(unitPrice × (1 − p / 100)),  p ∈ [0, 100]
//   ceilTol(x)    = ceil(x − 1e-6), never −0
//   costMinor     = (unitCost × rate) × 10^exp(cart currency), capped at 1e12,
//                   known only for a finite cost > 0 in the shop currency (`cur`);
//                   rate = 1 in the shop currency, else presentmentCurrencyRate
//                   (finite, > 0).
// Collections (Pro): the strictest across the product's `marginRefs` that the
// payload's `col` lists (max m, min p); an empty field is the global value.
// A product listing more than MAX_MARGIN_REFS (4) refs is not resolved ref by
// ref: it takes the payload's strictest setting (`strictest_margin`, every
// collection folded into the global values), and its refs are never read.
// A `col` key and a ref match when their texts are equal (`hasOwn(col, ref)`).
// Every key and ref the sync writes is a collection's numeric id, so both are
// read into a u64 when their text is a canonical decimal number (MarginRef),
// and `col` is a hash map by that number (drift audit P1: a 200-line cart with
// many refs per line paid ~1 900 instructions per ref for a binary search over
// String keys). Any other text keeps its text and compares by it: distinct
// texts never meet (a canonical number has exactly one text: "7", never "007").

use shopify_function::wasm_api::Value;

use super::config::MAX_MONEY_MINOR;
use super::table::Table;
use super::money::currency_exponent;
use crate::json::{entries, number, prop, string, Key};

/// ceilTol's tolerance, minor units (margin.ts MARGIN_TOLERANCE).
pub const MARGIN_TOLERANCE: f64 = 1e-6;
/// CONFIG_LIMITS.minMarginPercent: the highest minimum margin.
pub const MAX_MIN_MARGIN_PERCENT: f64 = 95.0;
/// margin.ts MAX_MARGIN_REFS: a product listing more `marginRefs` takes the
/// payload's strictest setting (never looser than any of its collections), and
/// a run never reads more than 4 refs a line (audit round 4b: 16–30 refs a
/// product took a 200-line run to 103–105 % of Shopify's instruction limit).
pub const MAX_MARGIN_REFS: usize = 4;
/// The ceiling without a cost when a hand-made value is not a number (margin.ts).
const DEFAULT_MAX_DISCOUNT_PERCENT: f64 = 50.0;

/// `ceil(x − 1e-6)`: float noise just above a whole minor unit never adds one; never −0.
pub fn ceil_tol(x: f64) -> f64 {
    let up = (x - MARGIN_TOLERANCE).ceil();
    if up == 0.0 {
        0.0
    } else {
        up
    }
}

/// `Math.min(max, Math.max(0, v))` for a finite `v` (a −0 result reads as 0).
fn clamp(v: f64, max: f64) -> f64 {
    let c = v.max(0.0).min(max);
    if c == 0.0 {
        0.0
    } else {
        c
    }
}

/// `modules.margin` when protection is ON (`readMarginPayload` enabled); off is `None`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MarginPayload {
    /// Global minimum margin, 0–95; none = 0.
    pub min: Option<f64>,
    /// Global maximum discount without a cost, 0–100.
    pub max: f64,
    /// The shop currency (upper-case ISO): the currency cost prices must be in.
    pub cur: Option<String>,
    /// Per collection (its `col` key, normally the numeric id): (minimum margin,
    /// maximum discount), one entry per key; a none is the global value.
    pub col: CollectionSettings,
}

impl MarginPayload {
    /// The setting of one collection (`hasOwn(col, ref) ? col[ref] : none`).
    pub fn collection(&self, key: &MarginRef) -> Option<Setting> {
        self.col.get(key)
    }
}

/// One collection's (minimum margin, maximum discount); a none is the global value.
pub type Setting = (Option<f64>, Option<f64>);

/// A `col` key or a `marginRefs` entry: a canonical decimal number (1–19
/// digits, no leading zero — the numeric id of a collection, as the sync writes
/// every one) as that number, any other text as it is. Two refs are the same
/// exactly when their texts are (a canonical number has one text).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum MarginRef {
    Id(u64),
    Text(String),
}

impl MarginRef {
    /// The number of a canonical decimal text: 1–19 ASCII digits (below 10^19 <
    /// 2^64, no overflow), without a leading zero unless it is "0" itself.
    fn id_of(text: &str) -> Option<u64> {
        let bytes = text.as_bytes();
        if bytes.is_empty() || bytes.len() > 19 || (bytes[0] == b'0' && bytes.len() > 1) {
            return None;
        }
        let mut n: u64 = 0;
        for &b in bytes {
            if !b.is_ascii_digit() {
                return None;
            }
            n = n * 10 + u64::from(b - b'0');
        }
        Some(n)
    }
}

impl From<String> for MarginRef {
    fn from(text: String) -> Self {
        match Self::id_of(&text) {
            Some(n) => Self::Id(n),
            None => Self::Text(text),
        }
    }
}

impl From<&str> for MarginRef {
    fn from(text: &str) -> Self {
        match Self::id_of(text) {
            Some(n) => Self::Id(n),
            None => Self::Text(text.to_string()),
        }
    }
}

/// The payload's `col`: numeric keys in a hash table, any other key (hand-made
/// junk only) in a small sorted list. Only ever looked up, never iterated in
/// the engine, so the hash order cannot change a result.
#[derive(Clone, Default)]
pub struct CollectionSettings {
    ids: Table<u64, Setting>,
    texts: Vec<(String, Setting)>,
}

impl PartialEq for CollectionSettings {
    fn eq(&self, other: &Self) -> bool {
        self.entries() == other.entries()
    }
}

impl std::fmt::Debug for CollectionSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.entries()).finish()
    }
}

impl CollectionSettings {
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty() && self.texts.is_empty()
    }

    pub fn len(&self) -> usize {
        self.ids.len() + self.texts.len()
    }

    pub fn get(&self, key: &MarginRef) -> Option<Setting> {
        match key {
            MarginRef::Id(n) => self.ids.get(n).copied(),
            MarginRef::Text(t) => self.texts.binary_search_by(|e| e.0.as_str().cmp(t)).ok().map(|i| self.texts[i].1),
        }
    }

    /// `col[key] = value` (some), or the key removed (none).
    fn set(&mut self, key: String, value: Option<Setting>) {
        match (MarginRef::from(key), value) {
            (MarginRef::Id(n), Some(v)) => {
                self.ids.insert(n, v);
            }
            (MarginRef::Id(n), None) => {
                self.ids.remove(&n);
            }
            (MarginRef::Text(t), v) => match (self.texts.binary_search_by(|e| e.0.as_str().cmp(&t)), v) {
                (Ok(i), Some(v)) => self.texts[i].1 = v,
                (Ok(i), None) => {
                    self.texts.remove(i);
                }
                (Err(i), Some(v)) => self.texts.insert(i, (t, v)),
                (Err(_), None) => {}
            },
        }
    }

    /// `strictestMargin`'s fold over every entry: the highest minimum margin and
    /// the lowest maximum discount, from (`min`, `max`), an empty field being
    /// the global value. Max and min of numbers: the hash order cannot matter.
    fn strictest(&self, global_min: f64, global_max: f64) -> (f64, f64) {
        let (mut m, mut p) = (global_min, global_max);
        for v in self.ids.iter().map(|(_, v)| v).chain(self.texts.iter().map(|(_, v)| v)) {
            m = m.max(v.0.unwrap_or(global_min));
            p = p.min(v.1.unwrap_or(global_max));
        }
        (m, p)
    }

    /// Every entry as (key text, m, p), sorted by the key text.
    pub fn entries(&self) -> Vec<(String, Option<f64>, Option<f64>)> {
        let mut out: Vec<_> = self.ids.iter().map(|(n, v)| (n.to_string(), v.0, v.1)).collect();
        out.extend(self.texts.iter().map(|(t, v)| (t.clone(), v.0, v.1)));
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }
}

fn is_currency(s: &str) -> bool {
    s.len() == 3 && s.bytes().all(|b| b.is_ascii_uppercase())
}

/// One tuple part: null → `Some(None)`, a number → clamped, anything else → `None` (the entry is ignored).
fn tuple_part(value: &Value, max: f64) -> Option<Option<f64>> {
    if value.is_null() {
        return Some(None);
    }
    number(value).map(|n| Some(clamp(n, max)))
}

/// `readMarginPayload` (margin.ts), the tolerant reader: anything but
/// `enabled === true` with a numeric `max` is OFF (the MVP 1 module shape
/// included). `max` 0–100, `min` 0–95 (not a number → none), `cur` only as an
/// upper-case ISO code, a `col` entry only as exactly `[number|null, number|null]`.
pub fn read_margin_payload(raw: &Value) -> Option<MarginPayload> {
    if !raw.is_obj() || prop(raw, Key::Enabled).as_bool() != Some(true) {
        return None;
    }
    let max = clamp(number(&prop(raw, Key::Max))?, 100.0);
    let mut out = MarginPayload {
        min: number(&prop(raw, Key::Min)).map(|m| clamp(m, MAX_MIN_MARGIN_PERCENT)),
        max,
        cur: string(&prop(raw, Key::Cur)).filter(|c| is_currency(c)),
        col: CollectionSettings::default(),
    };
    let col = prop(raw, Key::Col);
    if col.is_obj() {
        for (key, v) in entries(&col) {
            // `col["__proto__"] = …` sets the object's prototype in JS: it is never an own key.
            let valid = if key == "__proto__" || v.array_len() != Some(2) {
                None
            } else {
                tuple_part(&v.get_at_index(0), MAX_MIN_MARGIN_PERCENT).zip(tuple_part(&v.get_at_index(1), 100.0))
            };
            // JSON.parse keeps the last of duplicate keys, so a later entry
            // replaces (or, when invalid, removes) an earlier one.
            out.col.set(key, valid);
        }
    }
    Some(out)
}

/// The settings that apply to one product (`resolveMargin`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MarginSettings {
    pub min_margin_percent: f64,
    pub max_discount_percent: f64,
    /// Some of its collections has a setting (explain's "collection" source).
    pub collection: bool,
}

/// `resolveMargin`: the global values, or the strictest across the product's
/// collections that have a setting (max m, min p), an empty field being the global value.
pub fn resolve_margin(payload: &MarginPayload, margin_refs: &[MarginRef]) -> MarginSettings {
    let global_min = payload.min.unwrap_or(0.0);
    let global_max = payload.max;
    let mut out = MarginSettings { min_margin_percent: global_min, max_discount_percent: global_max, collection: false };
    if payload.col.is_empty() {
        return out;
    }
    for r in margin_refs {
        let Some((m, p)) = payload.collection(r) else { continue };
        let (collection_min, collection_max) = (m.unwrap_or(global_min), p.unwrap_or(global_max));
        if !out.collection {
            out = MarginSettings { min_margin_percent: collection_min, max_discount_percent: collection_max, collection: true };
        } else {
            out.min_margin_percent = out.min_margin_percent.max(collection_min);
            out.max_discount_percent = out.max_discount_percent.min(collection_max);
        }
    }
    out
}

/// `strictestMargin`: every collection folded into the global values (max m,
/// min p over the global values and every `col` entry) — what a product with
/// more than MAX_MARGIN_REFS refs gets. `collection` when a collection is
/// stricter than the global values in either one.
pub fn strictest_margin(payload: &MarginPayload) -> MarginSettings {
    let (global_min, global_max) = (payload.min.unwrap_or(0.0), payload.max);
    let (m, p) = payload.col.strictest(global_min, global_max);
    MarginSettings { min_margin_percent: m, max_discount_percent: p, collection: m != global_min || p != global_max }
}

/// Minor units per major unit of a currency: exactly 1, 100 or 1000.
fn minor_scale(currency: &str) -> f64 {
    match currency_exponent(currency) {
        0 => 1.0,
        3 => 1000.0,
        _ => 100.0,
    }
}

/// `costMinorUnits`: one item's cost in minor units of the CART currency, or
/// none when unknown (see the header). `(unitCost × rate) × scale`, capped at the money cap.
pub fn cost_minor_units(
    unit_cost: Option<f64>,
    unit_cost_currency: Option<&str>,
    rate: Option<f64>,
    cart_currency: &str,
    shop_currency: Option<&str>,
) -> Option<f64> {
    CostContext::new(rate, cart_currency, shop_currency).cost_minor_units(unit_cost, unit_cost_currency)
}

/// `costMinorUnits` with what depends only on the cart worked out once: the
/// shop currency, and the rate (1 in the shop currency) with the cart
/// currency's minor-unit scale — none when no cost can be converted.
pub struct CostContext<'s> {
    shop: Option<&'s str>,
    rate_and_scale: Option<(f64, f64)>,
}

impl<'s> CostContext<'s> {
    pub fn new(rate: Option<f64>, cart_currency: &str, shop_currency: Option<&'s str>) -> Self {
        let shop = shop_currency.filter(|s| !s.is_empty());
        let rate = match shop {
            Some(shop) if cart_currency == shop => Some(1.0),
            Some(_) => rate.filter(|r| r.is_finite() && *r > 0.0),
            None => None,
        };
        Self { shop, rate_and_scale: rate.map(|r| (r, minor_scale(cart_currency))) }
    }

    pub fn cost_minor_units(&self, unit_cost: Option<f64>, unit_cost_currency: Option<&str>) -> Option<f64> {
        let unit_cost = unit_cost.filter(|c| c.is_finite() && *c > 0.0)?;
        let shop = self.shop?;
        if unit_cost_currency != Some(shop) {
            return None;
        }
        let (r, scale) = self.rate_and_scale?;
        Some((unit_cost * r * scale).min(MAX_MONEY_MINOR))
    }
}

/// What a floor is based on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarginBasis {
    /// Cost + minimum margin.
    Cost,
    /// No known cost: the maximum discount %.
    MaxPercent,
}

/// `marginFloorUnit`: the lowest price of one item, minor units, in [0, money cap].
pub fn margin_floor_unit(unit_price: i64, cost_minor: Option<f64>, min_margin_percent: f64, max_discount_percent: f64) -> (i64, MarginBasis) {
    FloorRule::new(min_margin_percent, max_discount_percent).floor_unit(unit_price, cost_minor)
}

/// `marginFloorUnit` for one pair of settings: the factors `1 − m/100` and
/// `1 − p/100` (the same float expressions) worked out once, for every line they apply to.
#[derive(Debug, Clone, Copy)]
pub struct FloorRule {
    /// 1 − m/100, m clamped to 0–95 (not a number: 0).
    cost_divisor: f64,
    /// 1 − p/100, p clamped to 0–100 (not a number: 50).
    price_factor: f64,
}

impl FloorRule {
    pub fn new(min_margin_percent: f64, max_discount_percent: f64) -> Self {
        let m = if min_margin_percent.is_finite() { clamp(min_margin_percent, MAX_MIN_MARGIN_PERCENT) } else { 0.0 };
        let p = if max_discount_percent.is_finite() { clamp(max_discount_percent, 100.0) } else { DEFAULT_MAX_DISCOUNT_PERCENT };
        Self { cost_divisor: 1.0 - m / 100.0, price_factor: 1.0 - p / 100.0 }
    }

    /// The floor of one item: ceilTol(cost / (1 − m/100)) with a cost, else ceilTol(price × (1 − p/100)).
    pub fn floor_unit(&self, unit_price: i64, cost_minor: Option<f64>) -> (i64, MarginBasis) {
        if let Some(cost) = cost_minor.filter(|c| c.is_finite() && *c > 0.0) {
            let floor = ceil_tol(cost / self.cost_divisor);
            return (floor.max(0.0).min(MAX_MONEY_MINOR) as i64, MarginBasis::Cost);
        }
        let price = (unit_price as f64).max(0.0);
        let floor = ceil_tol(price * self.price_factor);
        (floor.max(0.0).min(MAX_MONEY_MINOR) as i64, MarginBasis::MaxPercent)
    }
}
