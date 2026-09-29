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
use crate::engine::money::{currency_exponent, from_minor_units_with, minor_units_len_with};
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
pub struct ProductCandidateOut<'p> {
    pub message: &'p str,
    /// Cart line ids.
    pub targets: Vec<&'p str>,
    pub value: ProductValue,
    /// What the candidate saves in total, minor units (not written; orders the last-resort drop).
    pub saves: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderCandidateOut<'p> {
    pub message: &'p str,
    pub excluded_cart_line_ids: &'p [&'p str],
    pub value: TotalValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryCandidateOut<'p> {
    pub message: &'p str,
    /// Delivery group ids.
    pub targets: &'p [String],
    pub value: TotalValue,
}

/// The output borrows its text from the plan and the function input (it is
/// written while they live, src/cart_*_run.rs): nothing is copied.
#[derive(Debug, Clone, PartialEq)]
pub enum CartOperation<'p> {
    /// `selectionStrategy: ALL`: every candidate targets other lines (≤ 1 product allocation per line).
    ProductDiscountsAdd(Vec<ProductCandidateOut<'p>>),
    /// `selectionStrategy: FIRST`.
    OrderDiscountsAdd(Vec<OrderCandidateOut<'p>>),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CartLinesResult<'p> {
    pub operations: Vec<CartOperation<'p>>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DeliveryResult<'p> {
    /// One `deliveryDiscountsAdd` (`selectionStrategy: ALL`) when there are candidates.
    pub candidates: Vec<DeliveryCandidateOut<'p>>,
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
//      - a value margin protection lowered (`PlanLine::margin_capped`) is always
//        its exact amount, never a percent: a tie rounded the other way would
//        take the line 1 minor unit under its floor;
//   2. candidates with the same message and value share one candidate with
//      several targets (a fixed total on one line never groups: shared, it would
//      be applied ONCE across all its targets);
//   3. over the budget (19 000 B, scaled like Shopify's limit) the output gives
//      up exactness step by step, the cheapest loss for the customer first, and
//      stops at the first step that fits: (a) rounding ties back to their
//      percent (at worst 1 minor unit per line); (b) every Pro stack as its top
//      rule's own value, ties exact again; (c) both. A step that changes nothing
//      (no tie, no stack) is skipped. Then, as a last resort, the product
//      candidates that save the least are dropped until it fits. A margin-capped
//      line is never relaxed (neither step touches it): it keeps its exact value
//      or is dropped. A margin-tight line (`PlanLine::margin_tight`) never has
//      its tie relaxed to a percent (its stack may still drop to its top rule,
//      which only ever gives less);
//   4. margin protection on (`PlanOrder::margin_protected`): every node emits its
//      order discount as the plan's exact amount, never a percent — a degraded
//      product output anywhere makes the order base Shopify sees larger, and a
//      percent of it could take a line under its floor. Margin off: unchanged.
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
    fn to_output(self, digits: usize) -> ProductValue {
        match self {
            DraftValue::Percent(p) => ProductValue::Percentage(p),
            DraftValue::PerItem(minor) => {
                ProductValue::FixedAmount { amount: from_minor_units_with(minor, digits), applies_to_each_item: true }
            }
            DraftValue::Total(minor) => {
                ProductValue::FixedAmount { amount: from_minor_units_with(minor, digits), applies_to_each_item: false }
            }
        }
    }
}

/// A product candidate before it is written; strings borrow from the plan.
struct Draft<'p> {
    message: &'p str,
    /// `quoted_len(message)`, computed once per distinct message.
    message_len: usize,
    targets: Vec<&'p str>,
    value: DraftValue,
    /// What it saves in total, minor units (orders the last-resort drop).
    saves: i64,
}

/// `roundingTiePossible` (function-output.ts): `base × percent / 100` minor
/// units is half a minor unit in decimal (Shopify's arithmetic). The tolerance
/// is the float error of that one expression (4·10⁻¹⁵ × exact, ~18 ulps, plus
/// an absolute 10⁻⁹), never a share of the amount. The same IEEE expression as
/// the TS reference, so both decide identically.
pub fn tie_possible(base: i64, percent: f64) -> bool {
    let exact = (base as f64 * percent) / 100.0;
    let fraction = exact - exact.floor();
    (fraction - 0.5).abs() <= 1e-9 + exact * 4e-15
}

/// How a budget step relaxes a pass (function-output.ts `Relax`).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Relax {
    /// Pro stacks as their top rule's own value.
    stacks: bool,
    /// Rounding ties as their percent instead of their exact amount.
    ties: bool,
}

/// A percent `p` on `line` whose amount is `amount`: exact on a tie unless ties
/// are relaxed — and always exact on a margin-tight line (never a relaxable tie).
fn percent_on_line(p: f64, amount: i64, line: &PlanLine, relax: Relax, any_tie: &mut bool) -> DraftValue {
    if !tie_possible(line.subtotal, p) {
        return DraftValue::Percent(p);
    }
    if line.margin_tight {
        return exact_amount(amount, line);
    }
    *any_tie = true;
    if relax.ties {
        DraftValue::Percent(p)
    } else {
        exact_amount(amount, line)
    }
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
fn exact_value(c: &ProductCandidate, line: &PlanLine, plan: &CartPlan, relax: Relax, any_tie: &mut bool) -> DraftValue {
    if line.margin_capped {
        return exact_amount(c.amount, line);
    }
    match c.value {
        EmittedValue::Percent(p) => percent_on_line(p, c.amount, line, relax, any_tie),
        EmittedValue::FixedPerItem(v) if v == line.unit_price => DraftValue::Percent(100.0),
        EmittedValue::FixedPerItem(v) => DraftValue::PerItem(v),
        EmittedValue::FixedTotal(total) => {
            if total == line.subtotal {
                return DraftValue::Percent(100.0);
            }
            let percent = line.product.as_ref().and_then(|stack| whole_percent_sum(plan, stack));
            if let Some(p) = percent {
                if js::round((line.subtotal as f64 * p) / 100.0) as i64 == total {
                    return percent_on_line(p, total, line, relax, any_tie);
                }
            }
            exact_amount(total, line)
        }
    }
}

/// A Pro stack emitted as its top rule's own value (the first component, which
/// the stack never caps): the rule's percent (its exact amount on a tie, unless
/// ties are relaxed), or its fixed amount per item.
fn top_rule_value<'p>(line: &PlanLine, plan: &'p CartPlan, relax: Relax, any_tie: &mut bool) -> Option<(DraftValue, &'p str, i64)> {
    let top = *line.product.as_ref()?.components.first()?;
    let rule = &plan.rules[top.rule];
    let value = if rule.value_kind == ValueKind::Percentage {
        percent_on_line(rule.percent, top.amount, line, relax, any_tie)
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

/// One pass over the node's product candidates.
struct Pass<'p> {
    /// Grouped by (value, message).
    drafts: Vec<Draft<'p>>,
    /// Some candidate is a Pro stack (relaxing stacks would change it).
    any_stack: bool,
    /// Some value is a rounding tie (relaxing ties would change it, or did).
    any_tie: bool,
}

/// The node's product candidates, grouped by (value, message), under `relax`.
fn drafts<'p>(emission: &NodeEmission<'p>, plan: &'p CartPlan, relax: Relax) -> Pass<'p> {
    let mut out: Vec<Draft<'p>> = Vec::new();
    // Messages are interned: most are one rule's label, the same `&str` for every
    // line, so a lookup by address finds it without hashing the text (a name can
    // be 200 characters); the text is hashed once per new address. Groups are
    // then keyed by (value, message number).
    let n = emission.product.len();
    let mut message_by_address: FnvMap<(usize, usize), u32> = FnvMap::with_capacity_and_hasher(n, Default::default());
    let mut message_by_text: FnvMap<&'p str, u32> = FnvMap::with_capacity_and_hasher(n, Default::default());
    let mut message_lens: Vec<usize> = Vec::new();
    // Sized once: on a margin-capped cart nearly every candidate is its own group.
    let mut groups: FnvMap<((u8, u64), u32), usize> = FnvMap::with_capacity_and_hasher(n, Default::default());
    // Consecutive lines usually carry the same message: the last one skips the address lookup.
    let mut last: ((usize, usize), u32) = ((0, 0), 0);
    let mut any_stack = false;
    let mut any_tie = false;
    for c in &emission.product {
        let Some(line) = plan.lines.get(c.line) else { continue };
        let Some(stack) = line.product.as_ref() else { continue };
        // A margin-capped stack is never relaxed to its top rule (its value stays exact).
        let stacked = stack.components.len() > 1 && !line.margin_capped;
        any_stack |= stacked;
        let top = if relax.stacks && stacked { top_rule_value(line, plan, relax, &mut any_tie) } else { None };
        let (value, message, saves) = match top {
            Some(top) => top,
            None => (exact_value(c, line, plan, relax, &mut any_tie), c.message, c.amount),
        };
        let address = (message.as_ptr() as usize, message.len());
        let number = if address == last.0 {
            last.1
        } else {
            match message_by_address.get(&address) {
                Some(&number) => number,
                None => {
                    let next = message_lens.len() as u32;
                    let number = *message_by_text.entry(message).or_insert(next);
                    if number == next {
                        message_lens.push(quoted_len(message));
                    }
                    message_by_address.insert(address, number);
                    number
                }
            }
        };
        last = (address, number);
        if let Some(key) = group_key(value) {
            match groups.entry((key, number)) {
                std::collections::hash_map::Entry::Occupied(group) => {
                    let draft = &mut out[*group.get()];
                    draft.targets.push(c.line_id);
                    draft.saves = draft.saves.saturating_add(saves);
                    continue;
                }
                std::collections::hash_map::Entry::Vacant(group) => {
                    group.insert(out.len());
                }
            }
        }
        out.push(Draft { message, message_len: message_lens[number as usize], targets: vec![c.line_id], value, saves });
    }
    Pass { drafts: out, any_stack, any_tie }
}

fn total_value(value: &EmittedValue, digits: usize) -> Option<TotalValue> {
    match value {
        EmittedValue::Percent(p) => Some(TotalValue::Percentage(*p)),
        EmittedValue::FixedTotal(amount) => Some(TotalValue::FixedAmount(from_minor_units_with(*amount, digits))),
        EmittedValue::FixedPerItem(_) => None,
    }
}

// --- Output size, computed from the parts (no text is built) ---------------------------------

/// UTF-8 bytes of `JSON.stringify(s)`. Most strings (line ids, names) need no
/// escape at all: that is checked 8 bytes at a time, and only a string with an
/// escape is counted byte by byte (the output budget measures every target id).
fn quoted_len(s: &str) -> usize {
    if !needs_escape(s.as_bytes()) {
        return s.len() + 2;
    }
    2 + s
        .bytes()
        .map(|b| match b {
            b'"' | b'\\' | 0x08 | 0x0c | b'\n' | b'\r' | b'\t' => 2,
            0..=0x1f => 6,
            _ => 1,
        })
        .sum::<usize>()
}

/// Some byte is a control character (< 0x20), `"` or `\\` — what JSON.stringify
/// escapes in a string (a Rust string has no lone surrogate). Word at a time:
/// `(w − 0x01…01 × n) & !w & 0x80…80` is non-zero exactly when some byte of w
/// is below n (n ≤ 0x80), and a byte equal to c is a zero byte of w ^ c×0x01…01.
fn needs_escape(bytes: &[u8]) -> bool {
    const ONES: u64 = 0x0101_0101_0101_0101;
    const HIGHS: u64 = 0x8080_8080_8080_8080;
    let below = |w: u64, n: u64| w.wrapping_sub(ONES * n) & !w & HIGHS;
    let mut words = bytes.chunks_exact(8);
    for word in &mut words {
        let w = u64::from_le_bytes([word[0], word[1], word[2], word[3], word[4], word[5], word[6], word[7]]);
        if below(w, 0x20) | below(w ^ (ONES * u64::from(b'"')), 1) | below(w ^ (ONES * u64::from(b'\\')), 1) != 0 {
            return true;
        }
    }
    words.remainder().iter().any(|&b| b < 0x20 || b == b'"' || b == b'\\')
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

fn draft_len(d: &Draft, digits: usize) -> usize {
    let targets: usize = d.targets.iter().map(|id| r#"{"cartLine":{"id":"#.len() + quoted_len(id) + r#"}}"#.len()).sum();
    let value = match d.value {
        DraftValue::Percent(p) => percentage_len(p),
        DraftValue::PerItem(m) => {
            r#"{"fixedAmount":{"amount":"#.len() + 2 + minor_units_len_with(m, digits) + r#","appliesToEachItem":true}}"#.len()
        }
        DraftValue::Total(m) => {
            r#"{"fixedAmount":{"amount":"#.len() + 2 + minor_units_len_with(m, digits) + r#","appliesToEachItem":false}}"#.len()
        }
    };
    r#"{"message":"#.len()
        + d.message_len
        + r#","targets":["#.len()
        + targets
        + d.targets.len().saturating_sub(1)
        + r#"],"value":"#.len()
        + value
        + 1
}

fn order_candidate_len(c: &OrderCandidateOut<'_>) -> usize {
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

/// Bytes of the order operation (`{"orderDiscountsAdd":…}`), none when there is no order candidate.
fn order_op_len(order: &[OrderCandidateOut<'_>]) -> Option<usize> {
    if order.is_empty() {
        return None;
    }
    let candidates: usize = order.iter().map(order_candidate_len).sum::<usize>() + order.len() - 1;
    Some(r#"{"orderDiscountsAdd":{"candidates":["#.len() + candidates + r#"],"selectionStrategy":"FIRST"}}"#.len())
}

/// Bytes of the whole output's compact JSON, from the product candidates' summed
/// size and count, and the order operation's size (`order_op_len`).
fn output_len(products_len: usize, products: usize, order_op: Option<usize>) -> usize {
    let (mut ops_len, mut ops) = (0usize, 0usize);
    if products > 0 {
        ops_len += r#"{"productDiscountsAdd":{"candidates":["#.len() + products_len + products - 1 + r#"],"selectionStrategy":"ALL"}}"#.len();
        ops += 1;
    }
    if let Some(order_op) = order_op {
        ops_len += order_op;
        ops += 1;
    }
    r#"{"operations":["#.len() + ops_len + ops.saturating_sub(1) + "]}".len()
}

/// The UTF-8 bytes of an output's compact JSON, by writing it (tests check the
/// arithmetic above against this).
#[cfg(test)]
pub fn json_bytes(result: &CartLinesResult<'_>) -> usize {
    let mut json = JsonText::counter();
    let _ = result.write(&mut json);
    json.bytes
}

/// `cart.lines.discounts.generate.run` output: only the classes the node has,
/// within the output budget for a cart of `line_count` lines.
pub fn cart_lines_result<'p>(
    emission: &NodeEmission<'p>,
    plan: &'p CartPlan,
    product: bool,
    order: bool,
    line_count: usize,
) -> CartLinesResult<'p> {
    let digits = currency_exponent(&plan.currency);
    let base = plan.order.as_ref().map_or(0, |o| o.base);
    let exact_order = plan.order.as_ref().is_some_and(|o| o.margin_protected);
    let order_candidates: Vec<OrderCandidateOut<'p>> = if order {
        emission
            .order
            .iter()
            .filter_map(|c| {
                let value = match c.value {
                    // Margin on, or a rounding tie: the exact amount (Shopify rounds a percent itself).
                    EmittedValue::Percent(p) if exact_order || tie_possible(base, p) => {
                        TotalValue::FixedAmount(from_minor_units_with(c.amount, digits))
                    }
                    ref value => total_value(value, digits)?,
                };
                Some(OrderCandidateOut { message: c.message, excluded_cart_line_ids: c.excluded_line_ids, value })
            })
            .collect()
    } else {
        Vec::new()
    };
    let exact = Relax { stacks: false, ties: false };
    let mut pass = if product { drafts(emission, plan, exact) } else { Pass { drafts: Vec::new(), any_stack: false, any_tie: false } };
    let lens_of = |drafts: &[Draft]| -> Vec<usize> { drafts.iter().map(|d| draft_len(d, digits)).collect() };
    let mut lens = lens_of(&pass.drafts);
    let budget = output_budget(line_count);
    // The order operation never changes below: its size is measured once.
    let order_op = order_op_len(&order_candidates);
    let result_len = |lens: &[usize]| output_len(lens.iter().sum(), lens.len(), order_op);
    let exact_len = result_len(&lens);
    if exact_len > budget {
        // The steps of the header, each only when it changes something.
        let mut relax = exact;
        let steps = [
            pass.any_tie.then_some(Relax { stacks: false, ties: true }),
            pass.any_stack.then_some(Relax { stacks: true, ties: false }),
        ];
        for step in steps.into_iter().flatten() {
            relax = step;
            pass = drafts(emission, plan, step);
            lens = lens_of(&pass.drafts);
            if result_len(&lens) <= budget {
                break;
            }
            // Stacks degraded and still over: relax the ties the degraded pass made too.
            if step.stacks && pass.any_tie {
                relax = Relax { stacks: true, ties: true };
                pass = drafts(emission, plan, relax);
                lens = lens_of(&pass.drafts);
                if result_len(&lens) <= budget {
                    break;
                }
            }
        }
        // Last resort: drop the candidate that saves the least (ties: the later
        // one) until the output fits. The size is kept as a running sum, never
        // re-measured per drop (that was quadratic on a big margin cart, whose
        // order candidate lists every capped line); the candidates are removed
        // once at the end.
        let dropped = {
            let products = &pass.drafts;
            let (mut total, mut count) = (lens.iter().sum::<usize>(), lens.len());
            let mut gone = vec![false; products.len()];
            let mut dropped = 0usize;
            if output_len(total, count, order_op) > budget {
                // A min-heap on (saves, later first): the pops are exactly the drops.
                let mut next: std::collections::BinaryHeap<std::cmp::Reverse<(i64, std::cmp::Reverse<usize>)>> =
                    products.iter().enumerate().map(|(k, d)| std::cmp::Reverse((d.saves, std::cmp::Reverse(k)))).collect();
                while count > 0 && output_len(total, count, order_op) > budget {
                    let Some(std::cmp::Reverse((_, std::cmp::Reverse(drop)))) = next.pop() else { break };
                    gone[drop] = true;
                    total -= lens[drop];
                    count -= 1;
                    dropped += 1;
                }
            }
            if dropped > 0 {
                let mut k = 0;
                pass.drafts.retain(|_| {
                    k += 1;
                    !gone[k - 1]
                });
                let mut k = 0;
                lens.retain(|_| {
                    k += 1;
                    !gone[k - 1]
                });
            }
            dropped
        };
        log!(
            "won-discounts: exact output {exact_len} B > budget {budget} B: ties as percent {}, Pro stacks as their top rule {}, {dropped} product candidate(s) dropped",
            relax.ties,
            relax.stacks
        );
    }
    let products = pass.drafts;
    #[cfg(test)]
    let expected_len = result_len(&lens);
    let mut operations = Vec::with_capacity(2);
    if !products.is_empty() {
        operations.push(CartOperation::ProductDiscountsAdd(
            products
                .into_iter()
                .map(|d| ProductCandidateOut {
                    message: d.message,
                    targets: d.targets,
                    value: d.value.to_output(digits),
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
pub fn delivery_result<'p>(
    emission: &NodeEmission<'p>,
    shipping: bool,
    group_ids: &'p [String],
    currency: &str,
) -> DeliveryResult<'p> {
    if !shipping || group_ids.is_empty() {
        return DeliveryResult::default();
    }
    let candidates = emission
        .delivery
        .iter()
        .map(|c| match c.value {
            ShippingValue::Percent(p) => DeliveryCandidateOut {
                message: c.message,
                targets: group_ids,
                value: TotalValue::Percentage(p),
            },
            ShippingValue::FixedTotal(amount) => DeliveryCandidateOut {
                message: c.message,
                targets: &group_ids[..1],
                value: TotalValue::FixedAmount(from_minor_units_with(amount, currency_exponent(currency))),
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

fn write_ids<S: Sink, T: AsRef<str>>(s: &mut S, ids: &[T], wrapper: &str) -> Result<(), Error> {
    s.array(ids.len(), |s| {
        for id in ids {
            s.object(1, |s| {
                s.key(wrapper)?;
                s.object(1, |s| {
                    s.key("id")?;
                    s.string(id.as_ref())
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

fn write_product_candidate<S: Sink>(s: &mut S, c: &ProductCandidateOut<'_>) -> Result<(), Error> {
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

fn write_order_candidate<S: Sink>(s: &mut S, c: &OrderCandidateOut<'_>) -> Result<(), Error> {
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
                        for id in c.excluded_cart_line_ids {
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

impl CartLinesResult<'_> {
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

impl DeliveryResult<'_> {
    pub fn write<S: Sink>(&self, s: &mut S) -> Result<(), Error> {
        s.object(1, |s| {
            s.key("operations")?;
            let ops = usize::from(!self.candidates.is_empty());
            s.array(ops, |s| {
                if ops == 0 {
                    return Ok(());
                }
                write_operation(s, "deliveryDiscountsAdd", &self.candidates, "ALL", |s, c: &DeliveryCandidateOut<'_>| {
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

impl Serialize for CartLinesResult<'_> {
    fn serialize(&self, context: &mut Context) -> Result<(), Error> {
        self.write(context)
    }
}

impl Serialize for DeliveryResult<'_> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The byte-by-byte count `quoted_len` falls back to.
    fn naive(s: &str) -> usize {
        2 + s
            .bytes()
            .map(|b| match b {
                b'"' | b'\\' | 0x08 | 0x0c | b'\n' | b'\r' | b'\t' => 2,
                0..=0x1f => 6,
                _ => 1,
            })
            .sum::<usize>()
    }

    #[test]
    fn quoted_len_is_json_stringify_length_word_at_a_time() {
        let mut cases: Vec<String> = vec![
            String::new(),
            "gid://shopify/CartLine/123".into(),
            "Velmi dlouhý název slevy ".repeat(9),
            "😀｡ř\u{7f}\u{80}\u{ff}".into(),
            "\u{2028}\u{2029}".into(),
        ];
        // Every character JSON escapes, at every position of a 17-byte string (both
        // word halves and the tail), next to multi-byte UTF-8.
        for special in ['"', '\\', '\n', '\r', '\t', '\u{8}', '\u{c}', '\u{0}', '\u{1}', '\u{1f}'] {
            for at in 0..17 {
                let mut s: String = "é".repeat(8).chars().take(at).collect();
                while s.len() < at {
                    s.push('a');
                }
                s.push(special);
                s.push_str("xyz ~ !\u{20}");
                cases.push(s);
            }
        }
        for s in &cases {
            assert_eq!(quoted_len(s), naive(s), "{s:?}");
            let mut json = JsonText::counter();
            json.string(s).unwrap();
            assert_eq!(quoted_len(s), json.bytes, "{s:?}");
        }
    }
}
