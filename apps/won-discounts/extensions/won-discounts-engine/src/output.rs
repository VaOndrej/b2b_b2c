// The function output (@won/core function-output.ts mapToFunctionOutput, the
// parity oracle through tests/reference-adapter.js), written through the Wasm API directly instead of the
// generated output types: the generated `Decimal` serializes as a string
// ("10.0") while the TS reference emits a JSON number (10), and the fixtures
// are the parity oracle. Keys are written in the reference's order; every
// object/array length is computed from the same data it writes.

use shopify_function::prelude::log;
use shopify_function::wasm_api::{write::Error, Context, Serialize};

use crate::engine::emit::{NodeEmission, ProductCandidate};
use crate::engine::js;
use crate::engine::fnv::FnvMap;
use crate::engine::money::{from_minor_units, minor_units_len};
use crate::engine::plan::{CartPlan, EmittedValue, PlanLine, PlanStack, ShippingValue, ValueKind};

#[derive(Debug, Clone, PartialEq)]
pub enum ProductValue {
    Percentage(f64),
    FixedAmount { amount: String, applies_to_each_item: bool },
}

/// Order and delivery values (no per-item variant).
#[derive(Debug, Clone, PartialEq)]
pub enum TotalValue {
    Percentage(f64),
    FixedAmount(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProductCandidateOut {
    pub message: String,
    /// Cart line ids.
    pub targets: Vec<String>,
    pub value: ProductValue,
    /// What the candidate saves in total, minor units (not written; orders the last-resort drop).
    pub saves: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderCandidateOut {
    pub message: String,
    pub excluded_cart_line_ids: Vec<String>,
    pub value: TotalValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryCandidateOut {
    pub message: String,
    /// Delivery group ids.
    pub targets: Vec<String>,
    pub value: TotalValue,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CartOperation {
    /// `selectionStrategy: ALL`: every candidate targets other lines (≤ 1 product allocation per line).
    ProductDiscountsAdd(Vec<ProductCandidateOut>),
    /// `selectionStrategy: FIRST`.
    OrderDiscountsAdd(Vec<OrderCandidateOut>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CartLinesResult {
    pub operations: Vec<CartOperation>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DeliveryResult {
    /// One `deliveryDiscountsAdd` (`selectionStrategy: ALL`) when there are candidates.
    pub candidates: Vec<DeliveryCandidateOut>,
}

// --- Emission → output (@won/core function-output.ts) ------------------------------------------
//
// Shopify refuses a function output over 20 kB (1 kB = 1000 B) for carts up to
// 200 lines — the limit scales with the line count above that
// (shopify.dev/docs/api/functions/2026-04, "Resource limits") — and then the
// node gives NO discount at all. So, exactly like the reference adapter:
//   1. every product value is emitted exactly, in the most groupable form:
//      - a fixed amount per item equal to the unit price (the item is free) → 100 %;
//      - a Pro stack (fixed total T on a line of subtotal S, quantity q):
//        T = S → 100 %; a stack of whole percents P whose Math.round(S × ΣP / 100)
//        is T → ΣP %; T divisible by q → T / q per item; else T once on that line;
//      - a percent whose amount lands on half a minor unit (`tie_possible`) →
//        its exact amount: Shopify rounds the decimal S × P / 100 itself and may
//        round a tie the other way than the plan. The same for a stack's summed
//        percent and for an order percent;
//   2. candidates with the same message and value share one candidate with
//      several targets (a fixed total on one line never groups: shared, it would
//      be applied ONCE across all its targets);
//   3. over the budget (19 000 B, scaled like Shopify's limit) every Pro stack
//      is emitted as its top rule's own value instead, then, as a last resort,
//      the product candidates that save the least are dropped until it fits.
// Sizes are the UTF-8 bytes of the compact JSON (what JSON.stringify writes).

/// Shopify's function output limit for carts up to 200 lines, bytes.
#[cfg(test)]
pub const OUTPUT_LIMIT_BYTES: usize = 20_000;
/// What the function allows itself, ≥ 5 % under the limit.
pub const OUTPUT_BUDGET_BYTES: usize = 19_000;

/// The budget for a cart of `line_count` lines (Shopify scales its limits above 200 lines).
pub fn output_budget(line_count: usize) -> usize {
    OUTPUT_BUDGET_BYTES * line_count.max(200) / 200
}

/// A product value before it is written (amounts stay minor units).
#[derive(Debug, Clone, Copy, PartialEq)]
enum DraftValue {
    Percent(f64),
    /// Fixed amount per item (`appliesToEachItem: true`).
    PerItem(i64),
    /// Fixed amount once on its one line (`appliesToEachItem: false`); never grouped.
    Total(i64),
}

impl DraftValue {
    fn to_output(self, currency: &str) -> ProductValue {
        match self {
            DraftValue::Percent(p) => ProductValue::Percentage(p),
            DraftValue::PerItem(minor) => {
                ProductValue::FixedAmount { amount: from_minor_units(minor, currency), applies_to_each_item: true }
            }
            DraftValue::Total(minor) => {
                ProductValue::FixedAmount { amount: from_minor_units(minor, currency), applies_to_each_item: false }
            }
        }
    }
}

/// A product candidate before it is written; strings borrow from the plan.
struct Draft<'p> {
    message: &'p str,
    targets: Vec<&'p str>,
    value: DraftValue,
    /// What it saves in total, minor units (orders the last-resort drop).
    saves: i64,
}

/// `roundingTiePossible` (function-output.ts): `base × percent / 100` minor
/// units may be half a minor unit in decimal (Shopify's arithmetic). The same
/// IEEE expression as the TS reference, so both decide identically.
pub fn tie_possible(base: i64, percent: f64) -> bool {
    let exact = (base as f64 * percent) / 100.0;
    let fraction = exact - exact.floor();
    (fraction - 0.5).abs() <= 1e-7 * exact.max(1.0)
}

/// An exact amount on one line: the whole line → 100 %, divisible → per item, else once on that line.
fn exact_amount(total: i64, line: &PlanLine) -> DraftValue {
    if total == line.subtotal {
        DraftValue::Percent(100.0)
    } else if line.quantity > 0 && total % line.quantity == 0 {
        DraftValue::PerItem(total / line.quantity)
    } else {
        DraftValue::Total(total)
    }
}

/// ΣP when every component of the stack is a whole-percent rule.
fn whole_percent_sum(plan: &CartPlan, stack: &PlanStack) -> Option<f64> {
    let mut sum = 0.0;
    for c in &stack.components {
        let rule = &plan.rules[c.rule];
        if rule.value_kind != ValueKind::Percentage || rule.percent.fract() != 0.0 {
            return None;
        }
        sum += rule.percent;
    }
    Some(sum)
}

/// One emitted product candidate → its exact output value, in the most groupable form.
fn exact_value(c: &ProductCandidate, line: &PlanLine, plan: &CartPlan) -> DraftValue {
    match c.value {
        EmittedValue::Percent(p) if tie_possible(line.subtotal, p) => exact_amount(c.amount, line),
        EmittedValue::Percent(p) => DraftValue::Percent(p),
        EmittedValue::FixedPerItem(v) if v == line.unit_price => DraftValue::Percent(100.0),
        EmittedValue::FixedPerItem(v) => DraftValue::PerItem(v),
        EmittedValue::FixedTotal(total) => {
            if total == line.subtotal {
                return DraftValue::Percent(100.0);
            }
            let percent = line.product.as_ref().and_then(|stack| whole_percent_sum(plan, stack));
            if let Some(p) = percent {
                if js::round((line.subtotal as f64 * p) / 100.0) as i64 == total && !tie_possible(line.subtotal, p) {
                    return DraftValue::Percent(p);
                }
            }
            exact_amount(total, line)
        }
    }
}

/// A Pro stack emitted as its top rule's own value (the first component, which
/// the stack never caps): the rule's percent (its exact amount on a tie), or
/// its fixed amount per item.
fn top_rule_value<'p>(line: &PlanLine, plan: &'p CartPlan) -> Option<(DraftValue, &'p str, i64)> {
    let top = *line.product.as_ref()?.components.first()?;
    let rule = &plan.rules[top.rule];
    let value = if rule.value_kind == ValueKind::Percentage {
        if tie_possible(line.subtotal, rule.percent) {
            exact_amount(top.amount, line)
        } else {
            DraftValue::Percent(rule.percent)
        }
    } else {
        let per_item = top.amount / line.quantity.max(1);
        if per_item == line.unit_price {
            DraftValue::Percent(100.0)
        } else {
            DraftValue::PerItem(per_item)
        }
    };
    Some((value, rule.label.as_ref(), top.amount))
}

/// What drafts group by, besides the message (DraftValue's f64 is not hashable).
fn group_key(value: DraftValue) -> Option<(u8, u64)> {
    match value {
        DraftValue::Percent(p) => Some((0, p.to_bits())),
        DraftValue::PerItem(m) => Some((1, m as u64)),
        DraftValue::Total(_) => None,
    }
}

/// The node's product candidates, grouped by (value, message), and whether any
/// of them is a Pro stack (which the degraded pass would change).
fn drafts<'p>(emission: &NodeEmission<'p>, plan: &'p CartPlan, degrade_stacks: bool) -> (Vec<Draft<'p>>, bool) {
    let mut out: Vec<Draft<'p>> = Vec::new();
    // Groups by message text; most messages are one rule's label, the same `&str`
    // for every line, so a lookup by address saves hashing the text again.
    let mut by_text: FnvMap<((u8, u64), &'p str), usize> = FnvMap::default();
    let mut by_address: FnvMap<((u8, u64), usize, usize), usize> = FnvMap::default();
    let mut any_stack = false;
    for c in &emission.product {
        let Some(line) = plan.lines.get(c.line) else { continue };
        let Some(stack) = line.product.as_ref() else { continue };
        any_stack |= stack.components.len() > 1;
        let top = if degrade_stacks && stack.components.len() > 1 { top_rule_value(line, plan) } else { None };
        let (value, message, saves) = top.unwrap_or_else(|| (exact_value(c, line, plan), c.message, c.amount));
        if let Some(key) = group_key(value) {
            let address = (key, message.as_ptr() as usize, message.len());
            let index = match by_address.get(&address) {
                Some(&index) => Some(index),
                None => {
                    let found = by_text.get(&(key, message)).copied();
                    by_address.insert(address, found.unwrap_or(out.len()));
                    if found.is_none() {
                        by_text.insert((key, message), out.len());
                    }
                    found
                }
            };
            if let Some(index) = index {
                out[index].targets.push(c.line_id);
                out[index].saves = out[index].saves.saturating_add(saves);
                continue;
            }
        }
        out.push(Draft { message, targets: vec![c.line_id], value, saves });
    }
    (out, any_stack)
}

fn total_value(value: &EmittedValue, currency: &str) -> Option<TotalValue> {
    match value {
        EmittedValue::Percent(p) => Some(TotalValue::Percentage(*p)),
        EmittedValue::FixedTotal(amount) => Some(TotalValue::FixedAmount(from_minor_units(*amount, currency))),
        EmittedValue::FixedPerItem(_) => None,
    }
}

// --- Output size, computed from the parts (no text is built) ---------------------------------

/// UTF-8 bytes of `JSON.stringify(s)`.
fn quoted_len(s: &str) -> usize {
    2 + s
        .bytes()
        .map(|b| match b {
            b'"' | b'\\' | 0x08 | 0x0c | b'\n' | b'\r' | b'\t' => 2,
            0..=0x1f => 6,
            _ => 1,
        })
        .sum::<usize>()
}

/// Length of `JSON.stringify(n)`.
fn number_len(n: f64) -> usize {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        let v = n as i64;
        let mut len = usize::from(v < 0);
        let mut rest = v.unsigned_abs();
        loop {
            len += 1;
            rest /= 10;
            if rest == 0 {
                return len;
            }
        }
    }
    js::number_to_string(n).len()
}

fn percentage_len(p: f64) -> usize {
    r#"{"percentage":{"value":"#.len() + number_len(p) + r#"}}"#.len()
}

fn draft_len(d: &Draft, currency: &str) -> usize {
    let targets: usize = d.targets.iter().map(|id| r#"{"cartLine":{"id":"#.len() + quoted_len(id) + r#"}}"#.len()).sum();
    let value = match d.value {
        DraftValue::Percent(p) => percentage_len(p),
        DraftValue::PerItem(m) => {
            r#"{"fixedAmount":{"amount":"#.len() + 2 + minor_units_len(m, currency) + r#","appliesToEachItem":true}}"#.len()
        }
        DraftValue::Total(m) => {
            r#"{"fixedAmount":{"amount":"#.len() + 2 + minor_units_len(m, currency) + r#","appliesToEachItem":false}}"#.len()
        }
    };
    r#"{"message":"#.len()
        + quoted_len(d.message)
        + r#","targets":["#.len()
        + targets
        + d.targets.len().saturating_sub(1)
        + r#"],"value":"#.len()
        + value
        + 1
}

fn order_candidate_len(c: &OrderCandidateOut) -> usize {
    let ids: usize = c.excluded_cart_line_ids.iter().map(|id| quoted_len(id)).sum();
    let value = match &c.value {
        TotalValue::Percentage(p) => percentage_len(*p),
        TotalValue::FixedAmount(amount) => r#"{"fixedAmount":{"amount":"#.len() + quoted_len(amount) + r#"}}"#.len(),
    };
    r#"{"message":"#.len()
        + quoted_len(&c.message)
        + r#","targets":[{"orderSubtotal":{"excludedCartLineIds":["#.len()
        + ids
        + c.excluded_cart_line_ids.len().saturating_sub(1)
        + r#"]}}],"value":"#.len()
        + value
        + 1
}

/// Bytes of the whole output's compact JSON, from each product candidate's size
/// (`product_lens`) and the order candidates.
fn result_len(product_lens: &[usize], order: &[OrderCandidateOut]) -> usize {
    let list = |lens: &mut dyn Iterator<Item = usize>, count: usize| lens.sum::<usize>() + count.saturating_sub(1);
    let mut ops = Vec::with_capacity(2);
    if !product_lens.is_empty() {
        ops.push(
            r#"{"productDiscountsAdd":{"candidates":["#.len()
                + list(&mut product_lens.iter().copied(), product_lens.len())
                + r#"],"selectionStrategy":"ALL"}}"#.len(),
        );
    }
    if !order.is_empty() {
        ops.push(
            r#"{"orderDiscountsAdd":{"candidates":["#.len()
                + list(&mut order.iter().map(order_candidate_len), order.len())
                + r#"],"selectionStrategy":"FIRST"}}"#.len(),
        );
    }
    r#"{"operations":["#.len() + list(&mut ops.iter().copied(), ops.len()) + "]}".len()
}

/// The UTF-8 bytes of an output's compact JSON, by writing it (tests check the
/// arithmetic above against this).
#[cfg(test)]
pub fn json_bytes(result: &CartLinesResult) -> usize {
    let mut json = JsonText::counter();
    let _ = result.write(&mut json);
    json.bytes
}

/// `cart.lines.discounts.generate.run` output: only the classes the node has,
/// within the output budget for a cart of `line_count` lines.
pub fn cart_lines_result(
    emission: &NodeEmission,
    plan: &CartPlan,
    product: bool,
    order: bool,
    line_count: usize,
) -> CartLinesResult {
    let currency = plan.currency.as_str();
    let base = plan.order.as_ref().map_or(0, |o| o.base);
    let order_candidates: Vec<OrderCandidateOut> = if order {
        emission
            .order
            .iter()
            .filter_map(|c| {
                let value = match c.value {
                    // A rounding tie: the exact amount (Shopify rounds the percent itself).
                    EmittedValue::Percent(p) if tie_possible(base, p) => {
                        TotalValue::FixedAmount(from_minor_units(c.amount, currency))
                    }
                    ref value => total_value(value, currency)?,
                };
                Some(OrderCandidateOut {
                    message: c.message.to_string(),
                    excluded_cart_line_ids: c.excluded_line_ids.iter().map(|id| id.to_string()).collect(),
                    value,
                })
            })
            .collect()
    } else {
        Vec::new()
    };
    let (mut products, any_stack) = if product { drafts(emission, plan, false) } else { (Vec::new(), false) };
    let mut lens: Vec<usize> = products.iter().map(|d| draft_len(d, currency)).collect();
    let budget = output_budget(line_count);
    let exact_len = result_len(&lens, &order_candidates);
    if exact_len > budget {
        if any_stack {
            products = drafts(emission, plan, true).0;
            lens = products.iter().map(|d| draft_len(d, currency)).collect();
        }
        let mut dropped = 0usize;
        while !products.is_empty() && result_len(&lens, &order_candidates) > budget {
            // Last resort: drop the candidate that saves the least (ties: the later one).
            let mut drop = 0;
            for (k, d) in products.iter().enumerate().skip(1) {
                if d.saves <= products[drop].saves {
                    drop = k;
                }
            }
            products.remove(drop);
            lens.remove(drop);
            dropped += 1;
        }
        log!(
            "won-discounts: exact output {exact_len} B > budget {budget} B: Pro stacks emitted as their top rule, {dropped} product candidate(s) dropped"
        );
    }
    #[cfg(test)]
    let expected_len = result_len(&lens, &order_candidates);
    let mut operations = Vec::with_capacity(2);
    if !products.is_empty() {
        operations.push(CartOperation::ProductDiscountsAdd(
            products
                .into_iter()
                .map(|d| ProductCandidateOut {
                    message: d.message.to_string(),
                    targets: d.targets.iter().map(|id| id.to_string()).collect(),
                    value: d.value.to_output(currency),
                    saves: d.saves,
                })
                .collect(),
        ));
    }
    if !order_candidates.is_empty() {
        operations.push(CartOperation::OrderDiscountsAdd(order_candidates));
    }
    let result = CartLinesResult { operations };
    // The size arithmetic must be exactly the written JSON (every native test run checks it).
    #[cfg(test)]
    assert_eq!(expected_len, json_bytes(&result), "output size arithmetic");
    result
}

/// `cart.delivery-options.discounts.generate.run` output: the shipping winner,
/// a percent on every delivery group, a fixed amount on the first group only
/// (Shopify's docs do not say one fixed candidate on several groups is taken
/// once; the plan counts it once).
pub fn delivery_result(emission: &NodeEmission, shipping: bool, group_ids: &[String], currency: &str) -> DeliveryResult {
    if !shipping || group_ids.is_empty() {
        return DeliveryResult::default();
    }
    let candidates = emission
        .delivery
        .iter()
        .map(|c| match c.value {
            ShippingValue::Percent(p) => DeliveryCandidateOut {
                message: c.message.to_string(),
                targets: group_ids.to_vec(),
                value: TotalValue::Percentage(p),
            },
            ShippingValue::FixedTotal(amount) => DeliveryCandidateOut {
                message: c.message.to_string(),
                targets: group_ids[..1].to_vec(),
                value: TotalValue::FixedAmount(from_minor_units(amount, currency)),
            },
        })
        .collect();
    DeliveryResult { candidates }
}

// --- Writing -------------------------------------------------------------------------------

/// Where output goes: the Wasm output (Context) or, in tests, JSON text.
pub trait Sink: Sized {
    fn object(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error>;
    fn array(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error>;
    fn key(&mut self, key: &str) -> Result<(), Error>;
    fn string(&mut self, value: &str) -> Result<(), Error>;
    fn number(&mut self, value: f64) -> Result<(), Error>;
    fn boolean(&mut self, value: bool) -> Result<(), Error>;
}

impl Sink for Context {
    fn object(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.write_object(f, len)
    }
    fn array(&mut self, len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.write_array(f, len)
    }
    fn key(&mut self, key: &str) -> Result<(), Error> {
        self.write_utf8_str(key)
    }
    fn string(&mut self, value: &str) -> Result<(), Error> {
        self.write_utf8_str(value)
    }
    /// An integral value as an integer (JSON `10`, as the TS reference), else a float.
    fn number(&mut self, value: f64) -> Result<(), Error> {
        if value.fract() == 0.0 && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX) {
            self.write_i32(value as i32)
        } else {
            self.write_f64(value)
        }
    }
    fn boolean(&mut self, value: bool) -> Result<(), Error> {
        self.write_bool(value)
    }
}

fn write_ids<S: Sink>(s: &mut S, ids: &[String], wrapper: &str) -> Result<(), Error> {
    s.array(ids.len(), |s| {
        for id in ids {
            s.object(1, |s| {
                s.key(wrapper)?;
                s.object(1, |s| {
                    s.key("id")?;
                    s.string(id)
                })
            })?;
        }
        Ok(())
    })
}

fn write_percentage<S: Sink>(s: &mut S, value: f64) -> Result<(), Error> {
    s.object(1, |s| {
        s.key("percentage")?;
        s.object(1, |s| {
            s.key("value")?;
            s.number(value)
        })
    })
}

fn write_total_value<S: Sink>(s: &mut S, value: &TotalValue) -> Result<(), Error> {
    match value {
        TotalValue::Percentage(p) => write_percentage(s, *p),
        TotalValue::FixedAmount(amount) => s.object(1, |s| {
            s.key("fixedAmount")?;
            s.object(1, |s| {
                s.key("amount")?;
                s.string(amount)
            })
        }),
    }
}

fn write_product_candidate<S: Sink>(s: &mut S, c: &ProductCandidateOut) -> Result<(), Error> {
    s.object(3, |s| {
        s.key("message")?;
        s.string(&c.message)?;
        s.key("targets")?;
        write_ids(s, &c.targets, "cartLine")?;
        s.key("value")?;
        match &c.value {
            ProductValue::Percentage(p) => write_percentage(s, *p),
            ProductValue::FixedAmount { amount, applies_to_each_item } => s.object(1, |s| {
                s.key("fixedAmount")?;
                s.object(2, |s| {
                    s.key("amount")?;
                    s.string(amount)?;
                    s.key("appliesToEachItem")?;
                    s.boolean(*applies_to_each_item)
                })
            }),
        }
    })
}

fn write_order_candidate<S: Sink>(s: &mut S, c: &OrderCandidateOut) -> Result<(), Error> {
    s.object(3, |s| {
        s.key("message")?;
        s.string(&c.message)?;
        s.key("targets")?;
        s.array(1, |s| {
            s.object(1, |s| {
                s.key("orderSubtotal")?;
                s.object(1, |s| {
                    s.key("excludedCartLineIds")?;
                    s.array(c.excluded_cart_line_ids.len(), |s| {
                        for id in &c.excluded_cart_line_ids {
                            s.string(id)?;
                        }
                        Ok(())
                    })
                })
            })
        })?;
        s.key("value")?;
        write_total_value(s, &c.value)
    })
}

fn write_operation<S: Sink, T>(
    s: &mut S,
    name: &str,
    candidates: &[T],
    strategy: &str,
    write: impl Fn(&mut S, &T) -> Result<(), Error>,
) -> Result<(), Error> {
    s.object(1, |s| {
        s.key(name)?;
        s.object(2, |s| {
            s.key("candidates")?;
            s.array(candidates.len(), |s| {
                for c in candidates {
                    write(s, c)?;
                }
                Ok(())
            })?;
            s.key("selectionStrategy")?;
            s.string(strategy)
        })
    })
}

impl CartLinesResult {
    pub fn write<S: Sink>(&self, s: &mut S) -> Result<(), Error> {
        s.object(1, |s| {
            s.key("operations")?;
            s.array(self.operations.len(), |s| {
                for op in &self.operations {
                    match op {
                        CartOperation::ProductDiscountsAdd(c) => {
                            write_operation(s, "productDiscountsAdd", c, "ALL", write_product_candidate)?
                        }
                        CartOperation::OrderDiscountsAdd(c) => {
                            write_operation(s, "orderDiscountsAdd", c, "FIRST", write_order_candidate)?
                        }
                    }
                }
                Ok(())
            })
        })
    }
}

impl DeliveryResult {
    pub fn write<S: Sink>(&self, s: &mut S) -> Result<(), Error> {
        s.object(1, |s| {
            s.key("operations")?;
            let ops = usize::from(!self.candidates.is_empty());
            s.array(ops, |s| {
                if ops == 0 {
                    return Ok(());
                }
                write_operation(s, "deliveryDiscountsAdd", &self.candidates, "ALL", |s, c: &DeliveryCandidateOut| {
                    s.object(3, |s| {
                        s.key("message")?;
                        s.string(&c.message)?;
                        s.key("targets")?;
                        write_ids(s, &c.targets, "deliveryGroup")?;
                        s.key("value")?;
                        write_total_value(s, &c.value)
                    })
                })
            })
        })
    }
}

impl Serialize for CartLinesResult {
    fn serialize(&self, context: &mut Context) -> Result<(), Error> {
        self.write(context)
    }
}

impl Serialize for DeliveryResult {
    fn serialize(&self, context: &mut Context) -> Result<(), Error> {
        self.write(context)
    }
}

// --- JSON text: JSON.stringify's compact form, or only its byte count --------------------

/// JSON.stringify-compatible compact JSON: the text (tests compare it with the
/// fixtures) or only its UTF-8 byte count (the output budget).
#[derive(Default)]
pub struct JsonText {
    pub out: String,
    pub bytes: usize,
    count_only: bool,
    /// Per open container: (is object, items written).
    stack: Vec<(bool, usize)>,
}

impl JsonText {
    pub fn counter() -> Self {
        Self { count_only: true, ..Self::default() }
    }

    fn push(&mut self, s: &str) {
        self.bytes += s.len();
        if !self.count_only {
            self.out.push_str(s);
        }
    }

    fn before_value(&mut self) {
        if let Some((false, count)) = self.stack.last_mut() {
            let first = *count == 0;
            *count += 1;
            if !first {
                self.push(",");
            }
        }
    }

    fn quote(&mut self, s: &str) {
        let plain = s.bytes().all(|b| b >= 0x20 && b != b'"' && b != b'\\');
        if plain {
            self.bytes += s.len() + 2;
            if !self.count_only {
                self.out.push('"');
                self.out.push_str(s);
                self.out.push('"');
            }
            return;
        }
        self.push("\"");
        let mut buf = [0u8; 4];
        for c in s.chars() {
            match c {
                '"' => self.push("\\\""),
                '\\' => self.push("\\\\"),
                '\u{8}' => self.push("\\b"),
                '\u{C}' => self.push("\\f"),
                '\n' => self.push("\\n"),
                '\r' => self.push("\\r"),
                '\t' => self.push("\\t"),
                c if (c as u32) < 0x20 => {
                    const HEX: &[u8; 16] = b"0123456789abcdef";
                    let code = c as u32;
                    let escaped = [b'\\', b'u', b'0', b'0', HEX[(code >> 4) as usize], HEX[(code & 0xf) as usize]];
                    self.push(std::str::from_utf8(&escaped).unwrap_or(""));
                }
                c => {
                    let text: &str = c.encode_utf8(&mut buf);
                    self.bytes += text.len();
                    if !self.count_only {
                        self.out.push_str(text);
                    }
                }
            }
        }
        self.push("\"");
    }

    fn container(&mut self, object: bool, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.before_value();
        self.push(if object { "{" } else { "[" });
        self.stack.push((object, 0));
        f(self)?;
        self.stack.pop();
        self.push(if object { "}" } else { "]" });
        Ok(())
    }
}

impl Sink for JsonText {
    fn object(&mut self, _len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.container(true, f)
    }
    fn array(&mut self, _len: usize, f: impl FnOnce(&mut Self) -> Result<(), Error>) -> Result<(), Error> {
        self.container(false, f)
    }
    fn key(&mut self, key: &str) -> Result<(), Error> {
        if let Some((true, count)) = self.stack.last_mut() {
            let first = *count == 0;
            *count += 1;
            if !first {
                self.push(",");
            }
        }
        self.quote(key);
        self.push(":");
        Ok(())
    }
    fn string(&mut self, value: &str) -> Result<(), Error> {
        self.before_value();
        self.quote(value);
        Ok(())
    }
    fn number(&mut self, value: f64) -> Result<(), Error> {
        self.before_value();
        if value.fract() == 0.0 && value.abs() < 1e15 {
            // Integral (the common case): no float formatting.
            let text = (value as i64).to_string();
            self.push(&text);
        } else {
            let text = js::number_to_string(value);
            self.push(&text);
        }
        Ok(())
    }
    fn boolean(&mut self, value: bool) -> Result<(), Error> {
        self.before_value();
        self.push(if value { "true" } else { "false" });
        Ok(())
    }
}
