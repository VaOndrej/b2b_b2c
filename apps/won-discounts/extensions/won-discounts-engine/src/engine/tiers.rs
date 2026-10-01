// Quantity tiers in the plan (MVP 3, contracts K1/K2): plan-tiers.ts
// `prepareTiers`, steps 1–5 of its port spec — every line's tier candidate
// `tier:<setId>`. Step 6 (the candidate next to the line's rules, never in a Pro
// stack) is plan.rs `plan_products` / `pick`. The set outcomes, counting groups
// and the "add N more" hint are TS-only (admin, storefront): no emission
// depends on them.
//
//   1. a line's set: gift lines none; `tierRef` absent or null → the payload's
//      global set; a string → the set with exactly that id (looked up in a
//      table built once), else none ("" and any other JSON value included);
//   2. eligible lines: not excluded (no gift, no outlet unless
//      `outletWithAnything`) — only they count and get a tier;
//   3. counting groups: "line" the line, "product" the set's lines of one
//      product id, "cart" every eligible line of the set;
//   4. the reached break: the highest `minQty` ≤ count among the breaks offered
//      in the cart currency (MKT-1: an amount break without an amount there is
//      not);
//   5. the candidate: a percent p → round(subtotal × p / 100) (engine/js.rs
//      `round`), value {percent: p}; an amount a → min(a, unit price) × quantity,
//      value {fixedPerItem}; 0 → none. Its message is describeTierBreak of the
//      reached break (the configured amount, not the capped one).

use super::cart::{LineTier, NormalizedLine};
use super::config::{TierCount, TierSet, TierValue, Tiers};
use super::describe::{describe_tier_break, TierBreakValue};
use super::js;
use super::money::mul_sat;
use super::plan::EmittedValue;
use super::table::{bytes_eq, text_hash, text_hash_full, Table};

/// A line's tier candidate (`w.tier` of plan-tiers.ts).
#[derive(Debug, Clone, PartialEq)]
pub struct TierCandidate {
    /// The set's index in `Tiers::sets` (its pseudo-rule is `CartPlan::rules[first tier + set]`).
    pub set: usize,
    /// Minor units it takes off the line, before margin protection.
    pub amount: i64,
    /// Its natural value: `{percent}` or `{fixedPerItem}`.
    pub value: EmittedValue,
    /// describeTierBreak of the reached break: one text per set and break for
    /// the whole run (the output groups messages by address).
    pub message: &'static str,
}

/// A break's value in the cart currency, when it is offered there.
fn offered(value: &TierValue, currency: Option<usize>) -> Option<TierBreakValue> {
    match value {
        TierValue::Percent(p) => Some(TierBreakValue::Percent(*p)),
        TierValue::Amount(list) => currency.and_then(|i| list.get(i).copied().flatten()).map(TierBreakValue::Amount),
    }
}

/// The tier sets by id (plan-tiers.ts `bySetId`): a map by a hash of the id in
/// the run's `u64` table, ids of one hash chained. Not a table of text keys:
/// the rule-id table's lookups — one per rule ref of every cart line — stay
/// inlined in their hot loop (a second user of that table cost ~240
/// instructions a line, measured).
pub struct SetIndex {
    first: Table<u64, usize>,
    next: Vec<usize>,
}

impl SetIndex {
    /// An empty index for `sets` (`add` them in order).
    pub fn new(sets: &[TierSet]) -> Self {
        Self { first: Table::with_capacity(sets.len()), next: vec![NO_GROUP; sets.len()] }
    }

    /// The index of every set (ids unique).
    pub fn of(sets: &[TierSet]) -> Self {
        let mut index = Self::new(sets);
        for i in 0..sets.len() {
            index.add(sets, i);
        }
        index
    }

    /// Adds set `i`, unless an earlier one has its id (the first of an id wins): whether it was added.
    pub fn add(&mut self, sets: &[TierSet], i: usize) -> bool {
        let id = sets[i].id.as_bytes();
        let mut at = *self.first.get_or_insert_with(text_hash(id), || i);
        if at == i {
            return true;
        }
        loop {
            if bytes_eq(sets[at].id.as_bytes(), id) {
                return false;
            }
            if self.next[at] == NO_GROUP {
                self.next[at] = i;
                return true;
            }
            at = self.next[at];
        }
    }

    /// The set with exactly this id.
    pub fn get(&self, sets: &[TierSet], id: &str) -> Option<usize> {
        let mut at = *self.first.get(&text_hash(id.as_bytes()))?;
        loop {
            if bytes_eq(sets[at].id.as_bytes(), id.as_bytes()) {
                return Some(at);
            }
            at = self.next[at];
            if at == NO_GROUP {
                return None;
            }
        }
    }
}

/// A counting group of a set counted per product or across the cart.
struct Group<'a> {
    set: usize,
    /// The product's id ("product"); "" across the cart.
    product: &'a str,
    count: i64,
    /// The next group whose key has the same hash (`NO_GROUP`: none).
    next: usize,
}

const NO_GROUP: usize = usize::MAX;

/// The counting group of (set, product id): looked up by a hash of both (the
/// run's `u64` table), groups of one hash chained (Wasm size: no table of its own).
fn group_of<'a>(groups: &mut Vec<Group<'a>>, by_hash: &mut Table<u64, usize>, set: usize, product: &'a str) -> usize {
    let fresh = groups.len();
    let mut g = *by_hash.get_or_insert_with(text_hash_full(product.as_bytes()) ^ (set as u64).rotate_left(40), || fresh);
    loop {
        if g == fresh {
            groups.push(Group { set, product, count: 0, next: NO_GROUP });
            return g;
        }
        if groups[g].set == set && bytes_eq(groups[g].product.as_bytes(), product.as_bytes()) {
            return g;
        }
        if groups[g].next == NO_GROUP {
            groups[g].next = fresh;
        }
        g = groups[g].next;
    }
}

/// Steps 1–5: each line's tier candidate, cart order; empty when the payload
/// has no set. `eligible(i)`: line i can take a product discount (plan.ts
/// `excluded === null`).
pub fn prepare_tiers(tiers: &Tiers, lines: &[NormalizedLine], of_lines: &[LineTier], eligible: impl Fn(usize) -> bool, currency: &str, cs: bool) -> Vec<Option<TierCandidate>> {
    let sets = &tiers.sets;
    if sets.is_empty() {
        return Vec::new();
    }
    let by_id = SetIndex::of(sets);
    // Steps 1–3: each eligible line's set, and its counting group ("line": none, its own quantity).
    let mut groups: Vec<Group> = Vec::new();
    let mut by_hash: Table<u64, usize> = Table::default();
    let mut of_line: Vec<(usize, usize)> = Vec::with_capacity(lines.len());
    for (i, line) in lines.iter().enumerate() {
        let read = of_lines.get(i).copied().unwrap_or_default();
        let set = if !eligible(i) {
            None
        } else {
            match read.tier_ref {
                None => tiers.global,
                Some(id) => by_id.get(sets, id),
            }
        };
        let Some(set) = set else {
            of_line.push((NO_GROUP, NO_GROUP));
            continue;
        };
        let group = match sets[set].count {
            TierCount::Line => NO_GROUP,
            TierCount::Product => group_of(&mut groups, &mut by_hash, set, read.product_id),
            TierCount::Cart => group_of(&mut groups, &mut by_hash, set, ""),
        };
        if group != NO_GROUP {
            groups[group].count = groups[group].count.saturating_add(line.quantity);
        }
        of_line.push((set, group));
    }

    // Steps 4–5: the reached break of each line's count and its candidate. A
    // message is built once per set and break.
    let mut message_of: Table<u64, usize> = Table::default();
    let mut messages: Vec<&'static str> = Vec::new();
    let mut out = Vec::with_capacity(lines.len());
    for (line, &(set, group)) in lines.iter().zip(&of_line) {
        if set == NO_GROUP {
            out.push(None);
            continue;
        }
        let count = if group == NO_GROUP { line.quantity } else { groups[group].count } as f64;
        let at = sets[set].currency_index(currency);
        let mut reached: Option<(usize, TierBreakValue)> = None;
        for (k, b) in sets[set].breaks.iter().enumerate() {
            let Some(value) = offered(&b.value, at) else { continue };
            if b.min_qty > count {
                break;
            }
            reached = Some((k, value));
        }
        let Some((k, value)) = reached else {
            out.push(None);
            continue;
        };
        let (amount, emitted) = match value {
            TierBreakValue::Percent(p) => (js::round((line.subtotal as f64 * p) / 100.0) as i64, EmittedValue::Percent(p)),
            TierBreakValue::Amount(a) => {
                let per_item = a.min(line.unit_price);
                (mul_sat(per_item, line.quantity), EmittedValue::FixedPerItem(per_item))
            }
        };
        if amount <= 0 {
            out.push(None);
            continue;
        }
        let fresh = messages.len();
        let at = *message_of.get_or_insert_with(((set as u64) << 32) | k as u64, || fresh);
        if at == fresh {
            messages.push(Box::leak(describe_tier_break(sets[set].breaks[k].min_qty, value, cs, currency).into_boxed_str()));
        }
        let message = messages[at];
        out.push(Some(TierCandidate { set, amount, value: emitted, message }));
    }
    out
}
