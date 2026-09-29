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

use shopify_function::wasm_api::Value;

use super::config::MAX_MONEY_MINOR;
use super::money::currency_exponent;
use crate::json::{entries, number, prop, string};

/// ceilTol's tolerance, minor units (margin.ts MARGIN_TOLERANCE).
pub const MARGIN_TOLERANCE: f64 = 1e-6;
/// CONFIG_LIMITS.minMarginPercent: the highest minimum margin.
pub const MAX_MIN_MARGIN_PERCENT: f64 = 95.0;
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
    /// Per collection (numeric id): (id, minimum margin, maximum discount), sorted
    /// by id, one entry per id; a none is the global value.
    pub col: Vec<(String, Option<f64>, Option<f64>)>,
}

impl MarginPayload {
    /// The setting of one collection (`hasOwn(col, id) ? col[id] : none`).
    pub fn collection(&self, id: &str) -> Option<(Option<f64>, Option<f64>)> {
        let i = self.col.binary_search_by(|e| e.0.as_str().cmp(id)).ok()?;
        Some((self.col[i].1, self.col[i].2))
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
    if !raw.is_obj() || prop(raw, "enabled").as_bool() != Some(true) {
        return None;
    }
    let max = clamp(number(&prop(raw, "max"))?, 100.0);
    let mut out = MarginPayload {
        min: number(&prop(raw, "min")).map(|m| clamp(m, MAX_MIN_MARGIN_PERCENT)),
        max,
        cur: string(&prop(raw, "cur")).filter(|c| is_currency(c)),
        col: Vec::new(),
    };
    let col = prop(raw, "col");
    if col.is_obj() {
        for (key, v) in entries(&col) {
            // `col["__proto__"] = …` sets the object's prototype in JS: it is never an own key.
            let valid = if key == "__proto__" || v.array_len() != Some(2) {
                None
            } else {
                tuple_part(&v.get_at_index(0), MAX_MIN_MARGIN_PERCENT).zip(tuple_part(&v.get_at_index(1), 100.0))
            };
            // Sorted by id; JSON.parse keeps the last of duplicate keys, so a later
            // entry replaces (or, when invalid, removes) an earlier one.
            match (out.col.binary_search_by(|e| e.0.as_str().cmp(&key)), valid) {
                (Ok(i), Some((m, p))) => out.col[i] = (key, m, p),
                (Ok(i), None) => {
                    out.col.remove(i);
                }
                (Err(i), Some((m, p))) => out.col.insert(i, (key, m, p)),
                (Err(_), None) => {}
            }
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
pub fn resolve_margin(payload: &MarginPayload, margin_refs: &[String]) -> MarginSettings {
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
