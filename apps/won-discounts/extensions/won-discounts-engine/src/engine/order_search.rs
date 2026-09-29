// `searchOrderSets` (@won/core plan-margin.ts): the order stage's search for the
// set of lines an order discount is safe on, as a pure function (plan.rs
// `protect_order` feeds it and turns its answer into the order discount).
//
// For a set I of lines, with S = Σ a_i (after product discounts) and S0 = Σ s_i
// (before them) and h_i what line i can give:
//   D_max(I) = min over I of min(floor((h_i × S) / a_i), floor((h_i × S0) / s_i)),
//   D(I)     = min(wanted(S), D_max(I)).
// Two orderings, k = h/s and k = h/a, each descending with ties in cart order;
// in each, every prefix that ends where k changes is a candidate, the largest D
// wins and a tie goes to the larger set. Across the two the larger D wins, a tie
// the larger set, a tie again the h/s one. Every float expression is the TS one,
// in its order; two ways of doing less work give the TS answer exactly:
//   - `NearMin`: D_max is taken only over the lines that can hold the minimum;
//   - the h/a ordering is not searched when it is the h/s sequence with the same
//     key groups (always so without product discounts): same prefixes, same set.
// Neither depends on `wanted`, which may be any function here (the unit tests
// use one that is not monotone).

/// One line of the search (`OrderSetLine`), given in cart order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OrderSetLine {
    /// a_i: the line after its product discount (> 0).
    pub after: i64,
    /// s_i: the line before it (its subtotal).
    pub before: i64,
    /// h_i = max(0, a_i − floorUnit × q − 1).
    pub headroom: i64,
}

/// A candidate set and what it allows (`OrderSetResult`).
#[derive(Debug, Clone, PartialEq)]
pub struct OrderSet {
    /// Positions in the searched lines (cart order), ascending.
    pub members: Vec<usize>,
    /// D = min(wanted, D_max).
    pub amount: i64,
    /// S of the set.
    pub base: i64,
    /// wanted(S).
    pub wanted: i64,
}

/// Both orderings' best sets and which one wins (`searchOrderSets`).
#[derive(Debug, Clone, PartialEq)]
pub struct OrderSearch {
    pub by_before: OrderSet,
    pub by_after: OrderSet,
    /// The h/a set wins (a larger D, or the same D and more lines).
    pub after_wins: bool,
    /// The h/a ordering was the h/s one, so it was not searched again (its set is the h/s set).
    pub after_skipped: bool,
}

impl OrderSearch {
    pub fn best(&self) -> &OrderSet {
        if self.after_wins {
            &self.by_after
        } else {
            &self.by_before
        }
    }
}

/// Relative slack of `NearMin`: far above the float error of the expressions it
/// compares (a few 2⁻⁵³), far below any real difference of rates.
const NEAR: f64 = 1e-9;

/// The lines of a prefix that can hold the minimum of one base's limit.
///
/// A line's limit on the after-product base is floor(fl(fl(h × S) / a)); for a
/// fixed S that is S × h/a up to a relative error of 2⁻⁵² (two roundings), and
/// floor is monotone. So a line whose rate h/a is more than (1 + NEAR) × the
/// prefix's smallest rate computes a value strictly above the smallest line's
/// value and can never be the minimum: min over the prefix = min over the lines
/// within (1 + NEAR) of the smallest rate — the same number the TS engine gets
/// by evaluating every line, in O(lines) instead of O(lines²) overall. The same
/// holds for h/s on the before-product base. The smallest rate only falls as a
/// prefix grows, so a line out once stays out.
#[derive(Default)]
struct NearMin {
    smallest: f64,
    /// Positions in the searched lines.
    members: Vec<usize>,
}

impl NearMin {
    fn add(&mut self, at: usize, rates: &[f64]) {
        let rate = rates[at];
        if self.members.is_empty() || rate < self.smallest {
            let bound = rate * (1.0 + NEAR);
            // Every member is at or above the old smallest rate.
            if self.smallest > bound {
                self.members.clear();
            } else {
                self.members.retain(|&m| rates[m] <= bound);
            }
            self.smallest = rate;
            self.members.push(at);
        } else if rate <= self.smallest * (1.0 + NEAR) {
            self.members.push(at);
        }
    }
}

/// The lines as floats, and their rates on both bases (TS `headroom / after`, `headroom / before`).
struct Prepared {
    after: Vec<f64>,
    before: Vec<f64>,
    headroom: Vec<f64>,
    per_after: Vec<f64>,
    per_before: Vec<f64>,
}

impl Prepared {
    fn new(lines: &[OrderSetLine]) -> Self {
        let after: Vec<f64> = lines.iter().map(|l| l.after as f64).collect();
        let before: Vec<f64> = lines.iter().map(|l| l.before as f64).collect();
        let headroom: Vec<f64> = lines.iter().map(|l| l.headroom as f64).collect();
        let per_after = headroom.iter().zip(&after).map(|(h, a)| h / a).collect();
        let per_before = headroom.iter().zip(&before).map(|(h, s)| h / s).collect();
        Self { after, before, headroom, per_after, per_before }
    }
}

/// The best prefix of one ordering (`bestPrefixSet`): (its size, D, S, wanted).
fn best_prefix(lines: &[OrderSetLine], p: &Prepared, order: &[usize], keys: &[f64], wanted_at: &dyn Fn(i64) -> i64) -> (usize, f64, i64, i64) {
    let mut best = (0usize, 0.0f64, 0i64, 0i64);
    let (mut base, mut base_before) = (0i64, 0i64);
    let (mut near_after, mut near_before) = (NearMin::default(), NearMin::default());
    for (j, &at) in order.iter().enumerate() {
        base = base.saturating_add(lines[at].after);
        base_before = base_before.saturating_add(lines[at].before);
        near_after.add(at, &p.per_after);
        near_before.add(at, &p.per_before);
        if order.get(j + 1).is_some_and(|&next| keys[next] == keys[at]) {
            continue;
        }
        let (s, s0) = (base as f64, base_before as f64);
        let mut limit = f64::INFINITY;
        for &m in &near_after.members {
            let by_after = ((p.headroom[m] * s) / p.after[m]).floor();
            if by_after < limit {
                limit = by_after;
            }
        }
        for &m in &near_before.members {
            let by_before = ((p.headroom[m] * s0) / p.before[m]).floor();
            if by_before < limit {
                limit = by_before;
            }
        }
        // D = min(wanted, limit) ≤ limit: a prefix whose limit is below the best D
        // can neither win nor tie, so its wanted amount is not needed.
        if limit < best.1 {
            continue;
        }
        let wanted = wanted_at(base);
        let amount = if (wanted as f64) < limit { wanted as f64 } else { limit };
        if amount >= best.1 {
            best = (j + 1, amount, base, wanted);
        }
    }
    best
}

/// The positions by `keys` descending, ties in cart order — the TS stable sort's
/// order. A key is a finite float ≥ +0, whose bits order like its value, so
/// (!bits, position) sorts ascending into exactly that order (a total order:
/// an unstable sort of integer pairs gives the same result).
fn ordered(keys: &[f64]) -> Vec<usize> {
    let mut pairs: Vec<(u64, u32)> = keys.iter().enumerate().map(|(at, k)| (!k.to_bits(), at as u32)).collect();
    pairs.sort_unstable();
    pairs.into_iter().map(|(_, at)| at as usize).collect()
}

/// Whether sorting by h/a gives exactly `by_before` (the h/s ordering) with the
/// same groups of equal keys: then both orderings have the same prefixes,
/// evaluated at the same places.
fn same_ordering(by_before: &[usize], p: &Prepared) -> bool {
    by_before.windows(2).all(|pair| {
        let (x, y) = (pair[0], pair[1]);
        if p.per_before[x] == p.per_before[y] {
            p.per_after[x] == p.per_after[y]
        } else {
            p.per_after[x] > p.per_after[y]
        }
    })
}

/// The winning prefix as a set, its members ascending (a mask, not a sort).
fn set_of(order: &[usize], best: (usize, f64, i64, i64)) -> OrderSet {
    let mut member = vec![false; order.len()];
    for &at in &order[..best.0] {
        member[at] = true;
    }
    let members = (0..order.len()).filter(|&at| member[at]).collect();
    OrderSet { members, amount: best.1 as i64, base: best.2, wanted: best.3 }
}

/// `searchOrderSets`: both orderings' best sets over `lines` (cart order).
pub fn search_order_sets(lines: &[OrderSetLine], wanted_at: &dyn Fn(i64) -> i64) -> OrderSearch {
    let p = Prepared::new(lines);
    let by_before_order = ordered(&p.per_before);
    let by_before = set_of(&by_before_order, best_prefix(lines, &p, &by_before_order, &p.per_before, wanted_at));
    if same_ordering(&by_before_order, &p) {
        return OrderSearch { by_after: by_before.clone(), by_before, after_wins: false, after_skipped: true };
    }
    let by_after_order = ordered(&p.per_after);
    let by_after = set_of(&by_after_order, best_prefix(lines, &p, &by_after_order, &p.per_after, wanted_at));
    let after_wins = by_after.amount > by_before.amount
        || (by_after.amount == by_before.amount && by_after.members.len() > by_before.members.len());
    OrderSearch { by_before, by_after, after_wins, after_skipped: false }
}
