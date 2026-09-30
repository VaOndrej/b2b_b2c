// `searchOrderSets` (@won/core plan-margin.ts): the order stage's search for the
// set of lines an order discount is safe on, as a pure function (plan.rs
// `protect_order` feeds it and turns its answer into the order discount).
//
// For a set I of lines, with S = Σ a_i (after product discounts) and S0 = Σ s_i
// (before them) and h_i what line i can give:
//   D_max(I) = min over I of min(floor((h_i × S) / a_i), floor((h_i × S0) / s_i)),
//   D(I)     = min(wanted(S), D_max(I)).
// On each base, D_max's part is exact while at most `EXACT_LINES` (16) distinct
// lines have a rate within 2⁻⁴⁸ of the set's smallest; with more it is the
// conservative bound floor((total × m) × (1 − 2⁻⁴⁴)), provably never above the
// exact minimum (plan-margin.ts `limitOnBase`: fail closed, the discount can only
// come out smaller). That bounds a prefix's work to O(16) whatever the cart.
// Two orderings, k = h/s and k = h/a, each descending with ties in cart order;
// in each, every prefix that ends where k changes is a candidate, the largest D
// wins and a tie goes to the larger set. Across the two the larger D wins, a tie
// the larger set, a tie again the h/s one. Every float expression is the TS one,
// in its order; two ways of doing less work give the TS answer exactly:
//   - `NearMin`: a base's minimum is taken only over the lines that can hold it,
//     at most 16 of them (more → the bound, as TS decides it);
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

/// `ORDER_SEARCH_EXACT_LINES` (plan-margin.ts): on a base, a set's limit is
/// evaluated line by line over at most this many distinct near-minimum lines.
pub const EXACT_LINES: usize = 16;
/// 1 + `ORDER_SEARCH_NEAR` = 1 + 2⁻⁴⁸ (exact in f64, the TS `1 + 2 ** -48`).
pub const NEAR_FACTOR: f64 = 1.0 + 1.0 / 281_474_976_710_656.0;
/// The bound's downward safety, 1 − 2⁻⁴⁴ (exact in f64, the TS `1 - 2 ** -44`).
pub const SAFE_BELOW: f64 = 1.0 - 1.0 / 17_592_186_044_416.0;
/// How many distinct near lines `NearMin` keeps: one more than it may evaluate.
const KEEP: usize = EXACT_LINES + 1;

/// The near-minimum lines of one base over a growing set (plan-margin.ts
/// `limitOnBase`): the lines whose rate is ≤ fl(m × NEAR_FACTOR), m the set's
/// smallest rate, one per distinct (h, price on the base) — equal lines have
/// equal values.
///
/// Why the minimum is among them: a line's value on a base is
/// floor(fl(fl(h × X) / x)), within a factor (1 ± u)² of X × h/x (u = 2⁻⁵³),
/// and its rate fl(h/x) is within (1 ± u) of h/x. A line whose rate is above
/// fl(m × NEAR_FACTOR) ≥ m × (1 + 2⁻⁴⁸)(1 − u) so computes a value at least that
/// of the line with rate m (2⁻⁴⁸ = 32 u covers the ~7 u of roundings), and floor
/// keeps the order: the minimum over the near lines is the minimum over the set,
/// which TS evaluates line by line.
///
/// It keeps at most KEEP = EXACT_LINES + 1 of them, the lowest-rate ones, so a
/// line costs O(KEEP) whatever the cart. Invariant: a near line that is not kept
/// (nor equal to a kept one) exists only while KEEP are kept, and its rate is ≥
/// every kept one's. So at most EXACT_LINES kept means they are all of them
/// (exact), and KEEP kept means there are more than EXACT_LINES (the bound). The
/// smallest rate only falls as the set grows, so a line out once stays out.
struct NearMin {
    smallest: f64,
    /// fl(smallest × NEAR_FACTOR).
    bound: f64,
    kept: [u32; KEEP],
    len: usize,
}

impl NearMin {
    fn new() -> Self {
        NearMin { smallest: f64::INFINITY, bound: f64::INFINITY, kept: [0; KEEP], len: 0 }
    }

    /// The kept slot with the highest rate.
    fn highest(&self, rates: &[f64]) -> usize {
        let mut slot = 0;
        for k in 1..self.len {
            if rates[self.kept[k] as usize] > rates[self.kept[slot] as usize] {
                slot = k;
            }
        }
        slot
    }

    /// Line `at` joins the set (`rates`, `h`, `x`: the base's rates, headrooms and prices).
    fn add(&mut self, at: usize, rates: &[f64], h: &[f64], x: &[f64]) {
        let rate = rates[at];
        if rate < self.smallest {
            // The new minimum (no kept line equals it: an equal line has the same rate).
            let bound = rate * NEAR_FACTOR;
            let far = self.smallest > bound;
            self.smallest = rate;
            self.bound = bound;
            if far {
                // Every line so far has a rate ≥ the old minimum, above the new bound.
                self.kept[0] = at as u32;
                self.len = 1;
                return;
            }
            let full = self.len == KEEP;
            let mut n = 0;
            for k in 0..self.len {
                let m = self.kept[k];
                if rates[m as usize] <= self.bound {
                    self.kept[n] = m;
                    n += 1;
                }
            }
            if full && n == KEEP {
                // Every kept line is still near (and lines not kept may be): more
                // than EXACT_LINES either way. The new line replaces the highest.
                let slot = self.highest(rates);
                self.kept[slot] = at as u32;
            } else {
                // A kept line fell out, or none was left out: either way the lines
                // not kept are out too, and the kept ones with the new one are all.
                self.kept[n] = at as u32;
                n += 1;
            }
            self.len = n;
        } else if rate <= self.bound {
            for k in 0..self.len {
                let m = self.kept[k] as usize;
                if h[m] == h[at] && x[m] == x[at] {
                    return; // equal to a kept line: the same value
                }
            }
            if self.len < KEEP {
                self.kept[self.len] = at as u32;
                self.len += 1;
            } else {
                let slot = self.highest(rates);
                if rate < rates[self.kept[slot] as usize] {
                    self.kept[slot] = at as u32;
                }
            }
        }
    }

    /// The base's limit at `total` (S or S0): the minimum over the near lines,
    /// or with more than EXACT_LINES of them the bound floor((total × m) × SAFE_BELOW),
    /// never above that minimum (proof: plan-margin.ts `limitOnBase`).
    fn limit(&self, total: f64, h: &[f64], x: &[f64]) -> f64 {
        if self.len > EXACT_LINES {
            return ((total * self.smallest) * SAFE_BELOW).floor();
        }
        let mut limit = f64::INFINITY;
        for &m in &self.kept[..self.len] {
            let m = m as usize;
            let value = ((h[m] * total) / x[m]).floor();
            if value < limit {
                limit = value;
            }
        }
        limit
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

/// D_max of a whole set (`orderSetLimit`): both bases' limits (plan.rs
/// `all_that_can_give` checks the set of every line that can give with it).
pub fn order_set_limit(lines: &[OrderSetLine]) -> f64 {
    let p = Prepared::new(lines);
    let (mut near_after, mut near_before) = (NearMin::new(), NearMin::new());
    let (mut base, mut base_before) = (0i64, 0i64);
    for (at, line) in lines.iter().enumerate() {
        base = base.saturating_add(line.after);
        base_before = base_before.saturating_add(line.before);
        near_after.add(at, &p.per_after, &p.headroom, &p.after);
        near_before.add(at, &p.per_before, &p.headroom, &p.before);
    }
    let by_after = near_after.limit(base as f64, &p.headroom, &p.after);
    let by_before = near_before.limit(base_before as f64, &p.headroom, &p.before);
    if by_before < by_after {
        by_before
    } else {
        by_after
    }
}

/// The best prefix of one ordering (`bestPrefixSet`): (its size, D, S, wanted).
fn best_prefix(lines: &[OrderSetLine], p: &Prepared, order: &[usize], keys: &[f64], wanted_at: &dyn Fn(i64) -> i64) -> (usize, f64, i64, i64) {
    let mut best = (0usize, 0.0f64, 0i64, 0i64);
    let (mut base, mut base_before) = (0i64, 0i64);
    let (mut near_after, mut near_before) = (NearMin::new(), NearMin::new());
    for (j, &at) in order.iter().enumerate() {
        base = base.saturating_add(lines[at].after);
        base_before = base_before.saturating_add(lines[at].before);
        near_after.add(at, &p.per_after, &p.headroom, &p.after);
        near_before.add(at, &p.per_before, &p.headroom, &p.before);
        if order.get(j + 1).is_some_and(|&next| keys[next] == keys[at]) {
            continue;
        }
        let by_after = near_after.limit(base as f64, &p.headroom, &p.after);
        let by_before = near_before.limit(base_before as f64, &p.headroom, &p.before);
        let limit = if by_before < by_after { by_before } else { by_after };
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
