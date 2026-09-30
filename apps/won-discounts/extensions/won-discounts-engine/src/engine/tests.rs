// Engine unit tests: the A1 rules (spec §3, plan.ts header) one by one, on
// plain carts. Configs are JSON as the shop metafield carries it, read by the
// same tolerant reader the function uses. Every test has a TS twin of the same
// name in tests/engine-unit.twins.test.js that runs the scenario through the TS
// engine and asserts the same values (the pairing itself is checked there):
// change a twin together with its test.

use shopify_function::run_function_with_input;

use super::cart::{CampaignInput, CartInput, LineInput};
use super::config::Config;
use super::emit::{emit_for_node, NodeEmission, NodeRole};
use super::margin::{ceil_tol, cost_minor_units, margin_floor_unit, resolve_margin, MarginBasis, MarginRef, MARGIN_TOLERANCE};
use super::order_search::{search_order_sets, OrderSet, OrderSetLine};
use super::plan::{plan_cart, CartPlan, EmittedValue, Excluded, PlanFailure, RuleState, ShippingValue};
use crate::json::ShopConfig;
use crate::output::{cart_lines_result, delivery_result, tie_possible, CartOperation, JsonText, ProductValue};

fn config(json: &str) -> Config {
    run_function_with_input(|c: ShopConfig| Ok(c), json).unwrap().0.expect("a valid config")
}

/// A config with these rules (JSON objects) and optional extra top-level keys.
fn rules(rules: &str, extra: &str) -> Config {
    let extra = if extra.is_empty() { String::new() } else { format!(", {extra}") };
    config(&format!(r#"{{"modules": {{"codes": {{"rules": [{rules}]}}}}{extra}}}"#))
}

fn pct(id: &str, percent: f64, more: &str) -> String {
    format!(
        r#"{{"id": "{id}", "enabled": true, "name": "{id}", "method": "automatic",
            "value": {{"kind": "percentage", "percent": {percent}}}, "target": {{"kind": "products"}}{more}}}"#
    )
}

fn code(id: &str, percent: f64, hashes: &str, more: &str) -> String {
    pct(id, percent, &format!(r#", "method": "code", "codeHashes": [{hashes}]{more}"#))
}

struct Line {
    id: &'static str,
    qty: i64,
    price: i64,
    refs: Vec<String>,
    outlet: bool,
    gift: bool,
    /// Margin protection: cost of one item in MAJOR units of `cur` (variant metafield).
    cost: Option<f64>,
    cur: Option<&'static str>,
    margin_refs: Vec<MarginRef>,
}

fn line(id: &'static str, qty: i64, price: i64, refs: &[&str]) -> Line {
    Line {
        id,
        qty,
        price,
        refs: refs.iter().map(|r| r.to_string()).collect(),
        outlet: false,
        gift: false,
        cost: None,
        cur: None,
        margin_refs: Vec::new(),
    }
}

/// A line with a cost price in CZK (the shop currency of the margin tests).
fn cost_line(id: &'static str, qty: i64, price: i64, cost: f64, refs: &[&str]) -> Line {
    Line { cost: Some(cost), cur: Some("CZK"), ..line(id, qty, price, refs) }
}

fn cart<'a>(lines: &'a [Line], codes: &[&'a str]) -> CartInput<'a> {
    CartInput {
        currency: "CZK".into(),
        country_code: Some("CZ"),
        lines: lines
            .iter()
            .map(|l| LineInput {
                id: l.id,
                quantity: l.qty,
                unit_price: l.price,
                outlet: l.outlet,
                gift: l.gift,
                rule_ids: &l.refs,
                variant_rule_ids: &[],
                unit_cost: l.cost,
                unit_cost_currency: l.cur,
                margin_refs: &l.margin_refs,
            })
            .collect(),
        entered_codes: codes.to_vec(),
        campaign: CampaignInput::default(),
        today: Some("2026-10-01"),
        locale_en: false,
        shop_to_cart_rate: None,
    }
}

fn state(plan: &CartPlan, id: &str) -> Option<RuleState> {
    plan.rules[plan.rule_index(id).expect("rule")].state
}

fn product_of<'p>(plan: &'p CartPlan, line: &str) -> Option<(&'p str, &'p EmittedValue, i64)> {
    let l = plan.lines.iter().find(|l| l.line_id == line)?;
    let s = l.product.as_ref()?;
    Some((plan.rules[s.owner].id, &s.value, s.amount))
}

fn lines_of<'a>(e: &NodeEmission<'a>) -> Vec<&'a str> {
    e.product.iter().map(|c| c.line_id).collect()
}

// code-hash.ts of the codes used below.
const WELCOME15: &str = r#""6a341c89""#;

#[test]
fn welcome15_hash_is_code_hash_ts() {
    assert_eq!(super::hash::code_hash("WELCOME15"), "6a341c89");
}

#[test]
fn per_line_the_better_discount_wins_never_a_sum() {
    let c = rules(&[pct("a", 10.0, ""), pct("b", 15.0, "")].join(","), "");
    let lines = [line("l1", 2, 10000, &["a", "b"]), line("l2", 1, 10000, &["a"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1"), Some(("b", &EmittedValue::Percent(15.0), 3000)));
    assert_eq!(product_of(&plan, "l2"), Some(("a", &EmittedValue::Percent(10.0), 1000)));
}

#[test]
fn ties_go_to_priority_then_id_never_config_order() {
    let c = rules(&[pct("zeta", 10.0, ""), pct("alpha", 10.0, "")].join(","), "");
    let lines = [line("l1", 1, 10000, &["zeta", "alpha"])];
    assert_eq!(product_of(&plan_cart(cart(&lines, &[]), Some(&c)), "l1").unwrap().0, "alpha");
    let c = rules(&[pct("zeta", 10.0, r#", "priority": 5"#), pct("alpha", 10.0, "")].join(","), "");
    assert_eq!(product_of(&plan_cart(cart(&lines, &[]), Some(&c)), "l1").unwrap().0, "zeta");
}

#[test]
fn a_code_rule_needs_its_code_and_only_its_node_emits_it() {
    let c = rules(&[pct("summer", 10.0, ""), code("welcome", 15.0, WELCOME15, "")].join(","), "");
    let lines = [line("l1", 1, 10000, &["summer", "welcome"]), line("l2", 1, 10000, &["summer"])];

    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(state(&plan, "welcome"), Some(RuleState::CodeNotEntered));
    assert_eq!(product_of(&plan, "l1").unwrap().0, "summer");

    // Entered in lower case with spaces: codes are case-insensitive.
    let plan = plan_cart(cart(&lines, &[" welcome15 "]), Some(&c));
    assert_eq!(product_of(&plan, "l1").unwrap().0, "welcome");
    let auto = emit_for_node(&plan, &NodeRole::Automatic, None);
    assert_eq!(lines_of(&auto), vec!["l2"]);
    let code_node = NodeRole::Code("welcome".into());
    assert_eq!(lines_of(&emit_for_node(&plan, &code_node, Some("Welcome15"))), vec!["l1"]);
    // Triggered by another code (or none): the code node emits nothing.
    assert!(emit_for_node(&plan, &code_node, Some("OTHER")).product.is_empty());
    assert!(emit_for_node(&plan, &code_node, None).product.is_empty());
    // A code node of an unknown or automatic rule emits nothing.
    assert!(emit_for_node(&plan, &NodeRole::Code("summer".into()), Some("WELCOME15")).product.is_empty());
    assert!(emit_for_node(&plan, &NodeRole::Code("nope".into()), Some("WELCOME15")).product.is_empty());
}

#[test]
fn a_shared_code_hash_belongs_to_the_first_rule_listing_it() {
    let c = rules(&[code("first", 5.0, WELCOME15, ""), code("second", 50.0, WELCOME15, "")].join(","), "");
    let lines = [line("l1", 1, 10000, &["first", "second"])];
    let plan = plan_cart(cart(&lines, &["WELCOME15"]), Some(&c));
    assert_eq!(state(&plan, "second"), Some(RuleState::CodeNotEntered));
    assert_eq!(product_of(&plan, "l1").unwrap().0, "first");
}

#[test]
fn outlet_lines_are_out_of_product_and_order_discounts() {
    let order = r#"{"id": "o", "enabled": true, "name": "o", "method": "automatic",
        "value": {"kind": "percentage", "percent": 10}, "target": {"kind": "order"}}"#;
    let c = rules(&[pct("a", 10.0, ""), order.to_string()].join(","), "");
    let mut lines = vec![line("l1", 1, 10000, &["a"]), line("l2", 1, 5000, &["a"])];
    lines[1].outlet = true;
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.lines[1].excluded, Some(Excluded::Outlet));
    assert!(plan.lines[1].product.is_none());
    let order = plan.order.as_ref().unwrap();
    // 10 % of (100 − 10 product discount) = 9; the outlet line is excluded.
    assert_eq!((order.base, order.stack.amount), (9000, 900));
    assert_eq!(order.excluded_line_ids, vec!["l2"]);

    // Only outlet lines targeted: outlet_only.
    let only = [Line { outlet: true, ..line("l1", 1, 10000, &["a"]) }];
    assert_eq!(state(&plan_cart(cart(&only, &[]), Some(&c)), "a"), Some(RuleState::OutletOnly));

    // engine.combination.outletWithAnything: outlet lines are ordinary lines.
    let c = rules(&pct("a", 10.0, ""), r#""engine": {"combination": {"outletWithAnything": true}}"#);
    let plan = plan_cart(cart(&only, &[]), Some(&c));
    assert_eq!(plan.lines[0].excluded, None);
    assert_eq!(product_of(&plan, "l1").unwrap().2, 1000);
}

#[test]
fn gift_lines_are_outside_every_discount_and_every_threshold() {
    let ship = r#"{"id": "s", "enabled": true, "name": "s", "method": "automatic", "value": {"kind": "freeShipping"},
        "target": {"kind": "shipping"}, "minimum": {"subtotal": {"CZK": 20000}}}"#;
    let c = rules(&[pct("a", 10.0, ""), ship.to_string()].join(","), "");
    let mut lines = vec![line("l1", 1, 10000, &["a"]), line("gift", 1, 50000, &["a"])];
    lines[1].gift = true;
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.lines[1].excluded, Some(Excluded::Gift));
    assert!(plan.lines[1].product.is_none());
    // The 500 Kč gift does not count toward the 200 Kč minimum.
    assert_eq!(state(&plan, "s"), Some(RuleState::BelowMinimum));
}

#[test]
fn the_minimum_is_the_whole_cart_outlet_included() {
    let c = rules(&pct("a", 10.0, r#", "minimum": {"subtotal": {"CZK": 20000}, "quantity": 3}"#), "");
    let mut lines = vec![line("l1", 1, 10000, &["a"]), line("l2", 2, 5000, &[])];
    lines[1].outlet = true;
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(state(&plan, "a"), None);
    assert_eq!(product_of(&plan, "l1").unwrap().2, 1000);
    let short = [line("l1", 2, 10000, &["a"])];
    assert_eq!(state(&plan_cart(cart(&short, &[]), Some(&c)), "a"), Some(RuleState::BelowMinimum));
}

#[test]
fn a_currency_without_a_value_takes_the_rule_out_of_play() {
    let fixed = r#"{"id": "f", "enabled": true, "name": "f", "method": "automatic",
        "value": {"kind": "fixed", "amount": {"EUR": 500}}, "target": {"kind": "products"}}"#;
    let min = pct("m", 10.0, r#", "minimum": {"subtotal": {"EUR": 1000}}"#);
    let c = rules(&[fixed.to_string(), min].join(","), "");
    let lines = [line("l1", 1, 10000, &["f", "m"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(state(&plan, "f"), Some(RuleState::CurrencyMissing));
    assert_eq!(state(&plan, "m"), Some(RuleState::CurrencyMissing));
    assert!(plan.lines[0].product.is_none());
}

#[test]
fn fixed_amounts_are_capped_per_item_and_at_the_order_base() {
    let per_item = r#"{"id": "f", "enabled": true, "name": "f", "method": "automatic",
        "value": {"kind": "fixed", "amount": {"CZK": 5000}}, "target": {"kind": "products"}}"#;
    let order = r#"{"id": "o", "enabled": true, "name": "o", "method": "automatic",
        "value": {"kind": "fixed", "amount": {"CZK": 1000000}}, "target": {"kind": "order"}}"#;
    let c = rules(&[per_item.to_string(), order.to_string()].join(","), "");
    let lines = [line("l1", 2, 3000, &["f"]), line("l2", 1, 8000, &["f"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1"), Some(("f", &EmittedValue::FixedPerItem(3000), 6000)));
    assert_eq!(product_of(&plan, "l2"), Some(("f", &EmittedValue::FixedPerItem(5000), 5000)));
    // The order base after product discounts is 140 − 110 = 30 Kč.
    let order = plan.order.as_ref().unwrap();
    assert_eq!((order.base, &order.stack.value), (3000, &EmittedValue::FixedTotal(3000)));
}

#[test]
fn percentages_round_half_up_like_math_round() {
    let c = rules(&pct("a", 10.0, ""), "");
    // 10 % of 10.05 Kč = 100.5 haléřů → 101; of 10.04 Kč → 100.4 → 100.
    let lines = [line("l1", 1, 1005, &["a"]), line("l2", 1, 1004, &["a"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1").unwrap().2, 101);
    assert_eq!(product_of(&plan, "l2").unwrap().2, 100);
    // A fractional percent keeps its value; 12.5 % of 3 × 33.33 Kč = 1249.875 → 1250.
    let c = rules(&pct("a", 12.5, ""), "");
    let lines = [line("l1", 3, 3333, &["a"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1"), Some(("a", &EmittedValue::Percent(12.5), 1250)));
}

#[test]
fn exclusive_order_vs_products_better_scenario_wins_tie_keeps_products() {
    let order = |p: f64| {
        format!(
            r#"{{"id": "o", "enabled": true, "name": "o", "method": "automatic",
            "value": {{"kind": "percentage", "percent": {p}}}, "target": {{"kind": "order"}}}}"#
        )
    };
    let off = r#""engine": {"combination": {"productWithOrder": false}}"#;
    let lines = [line("l1", 1, 10000, &["a"]), line("l2", 1, 10000, &[])];
    // Products 10 % of 100 = 10 Kč; order 20 % of 200 = 40 Kč: the order wins, products are dropped.
    let c = rules(&[pct("a", 10.0, ""), order(20.0)].join(","), off);
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert!(plan.lines.iter().all(|l| l.product.is_none()));
    assert_eq!(plan.order.as_ref().unwrap().stack.amount, 4000);
    // Order 5 % of 200 = 10 Kč = the product total: a tie keeps the products.
    let c = rules(&[pct("a", 10.0, ""), order(5.0)].join(","), off);
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert!(plan.order.is_none());
    assert_eq!(product_of(&plan, "l1").unwrap().2, 1000);
}

#[test]
fn shipping_percent_beats_fixed_and_the_switches_can_block_it() {
    let ship = |id: &str, value: &str| {
        format!(
            r#"{{"id": "{id}", "enabled": true, "name": "{id}", "method": "automatic",
            "value": {value}, "target": {{"kind": "shipping"}}}}"#
        )
    };
    let free = ship("free", r#"{"kind": "freeShipping"}"#);
    let fixed = ship("fixed", r#"{"kind": "fixed", "amount": {"CZK": 999900}}"#);
    let half = ship("half", r#"{"kind": "percentage", "percent": 50}"#);
    let c = rules(&[fixed.clone(), half.clone(), free.clone(), pct("a", 10.0, "")].join(","), "");
    let lines = [line("l1", 1, 10000, &["a"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let shipping = plan.shipping.as_ref().unwrap();
    assert_eq!((plan.rules[shipping.rule].id, &shipping.value), ("free", &ShippingValue::Percent(100.0)));
    let c = rules(&[fixed.clone(), pct("a", 10.0, "")].join(","), "");
    let shipping = plan_cart(cart(&lines, &[]), Some(&c)).shipping.unwrap();
    assert_eq!(shipping.value, ShippingValue::FixedTotal(999900));
    // productWithShipping off: a product discount applies, so no shipping discount.
    let c = rules(&[free, pct("a", 10.0, "")].join(","), r#""engine": {"combination": {"productWithShipping": false}}"#);
    assert!(plan_cart(cart(&lines, &[]), Some(&c)).shipping.is_none());
}

#[test]
fn schedules_are_shop_local_days_end_inclusive_fail_closed() {
    let sched = |s: &str| pct("a", 10.0, &format!(r#", "schedule": {s}"#));
    let lines = [line("l1", 1, 10000, &["a"])];
    let run = |s: &str, today: Option<&'static str>| {
        let c = rules(&sched(s), "");
        let mut input = cart(&lines, &[]);
        input.today = today;
        state(&plan_cart(input, Some(&c)), "a")
    };
    let today = Some("2026-10-01");
    assert_eq!(run(r#"{"startsOn": "2026-10-02"}"#, today), Some(RuleState::NotStarted));
    assert_eq!(run(r#"{"startsOn": "2026-09-01", "endsOn": "2026-10-01"}"#, today), None);
    assert_eq!(run(r#"{"endsOn": "2026-09-30"}"#, today), Some(RuleState::Ended));
    assert_eq!(run(r#"{"startsOn": "2026-09-01"}"#, None), Some(RuleState::ScheduleUnknown));
    assert_eq!(run(r#"{"invalid": true}"#, today), Some(RuleState::ScheduleUnknown));
    assert_eq!(run(r#"{"startsOn": "2026-09-01T00:00:00+02:00"}"#, today), Some(RuleState::ScheduleUnknown));
    assert_eq!(run("{}", today), Some(RuleState::ScheduleUnknown));
    assert_eq!(run("null", today), None);
}

#[test]
fn market_targeting_matches_the_cart_country() {
    let c = rules(&pct("a", 10.0, r#", "targeting": {"markets": ["eu"]}"#), r#""marketCountries": {"eu": ["cz", "SK"]}"#);
    let lines = [line("l1", 1, 10000, &["a"])];
    assert_eq!(state(&plan_cart(cart(&lines, &[]), Some(&c)), "a"), None);
    let mut other = cart(&lines, &[]);
    other.country_code = Some("DE");
    assert_eq!(state(&plan_cart(other, Some(&c)), "a"), Some(RuleState::Market));
    let mut unknown = cart(&lines, &[]);
    unknown.country_code = None;
    assert_eq!(state(&plan_cart(unknown, Some(&c)), "a"), Some(RuleState::Market));
    let c = rules(&pct("a", 10.0, r#", "targeting": {"segments": ["vip"]}"#), "");
    assert_eq!(state(&plan_cart(cart(&lines, &[]), Some(&c)), "a"), Some(RuleState::Unsupported));
}

#[test]
fn a_pro_stack_sums_capped_and_is_owned_by_its_code_rule() {
    let c = rules(
        &[
            pct("p7", 15.0, r#", "combinesWith": {"ruleIds": ["p8"]}"#),
            pct("p8", 17.0, ""),
            code("c", 12.0, WELCOME15, r#", "combinesWith": {"ruleIds": ["p8"]}"#),
        ]
        .join(","),
        "",
    );
    let lines = [line("l1", 1, 10000, &["p7", "p8"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let stack = plan.lines[0].product.as_ref().unwrap();
    assert_eq!((stack.amount, &stack.value, stack.message.as_ref()), (3200, &EmittedValue::FixedTotal(3200), "p8 + p7"));
    // p8 + c (the code entered): the stack contains a code rule, so the code rule owns it.
    let lines = [line("l1", 1, 10000, &["p8", "c"])];
    let plan = plan_cart(cart(&lines, &["WELCOME15"]), Some(&c));
    let stack = plan.lines[0].product.as_ref().unwrap();
    assert_eq!(stack.message, "p8 + c");
    assert_eq!(plan.rules[stack.owner].id, "c");
    assert!(emit_for_node(&plan, &NodeRole::Automatic, None).product.is_empty());
    assert_eq!(emit_for_node(&plan, &NodeRole::Code("c".into()), Some("welcome15")).product.len(), 1);
    // Capped at the line subtotal.
    let c = rules(&[pct("x", 60.0, r#", "combinesWith": {"ruleIds": ["y"]}"#), pct("y", 70.0, "")].join(","), "");
    let lines = [line("l1", 1, 10000, &["x", "y"])];
    let stack = plan_cart(cart(&lines, &[]), Some(&c)).lines[0].product.clone().unwrap();
    assert_eq!(stack.amount, 10000);
    assert_eq!(stack.components.iter().map(|c| c.amount).collect::<Vec<_>>(), vec![7000, 3000]);
}

/// `"combinesWith": {"ruleIds": [the ids after k]}`: with every rule, a full Pro mesh.
fn mesh_link(ids: &[&str], k: usize) -> String {
    let later: Vec<String> = ids[k + 1..].iter().map(|id| format!(r#""{id}""#)).collect();
    format!(r#", "combinesWith": {{"ruleIds": [{}]}}"#, later.join(", "))
}

#[test]
fn a_pro_stack_is_searched_among_the_six_best_ranked_candidates_only() {
    // A full mesh of 8 rules, 10 % … 3 %: the 6 best stack; g and h never do.
    let ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let mesh: Vec<String> = ids.iter().enumerate().map(|(k, id)| pct(id, (10 - k) as f64, &mesh_link(&ids, k))).collect();
    let c = rules(&mesh.join(","), "");
    let lines = [line("l1", 1, 100000, &ids)];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let stack = plan.lines[0].product.as_ref().unwrap();
    let parts: Vec<(&str, i64)> = stack.components.iter().map(|c| (plan.rules[c.rule].id, c.amount)).collect();
    assert_eq!(parts, vec![("a", 10000), ("b", 9000), ("c", 8000), ("d", 7000), ("e", 6000), ("f", 5000)]);
    assert_eq!((stack.amount, &stack.value, stack.message.as_ref()), (45000, &EmittedValue::FixedTotal(45000), "a + b + c + d + e + f"));
    // Exactly 6 candidates: all of them stack.
    let six = [line("l1", 1, 100000, &ids[..6])];
    assert_eq!(plan_cart(cart(&six, &[]), Some(&c)).lines[0].product.as_ref().unwrap().components.len(), 6);
    // A partner ranked 7th cannot join: a (10 %) lists only g (4 %), the rest combine with nothing.
    let c = rules(
        &[
            pct("a", 10.0, r#", "combinesWith": {"ruleIds": ["g"]}"#),
            pct("b", 9.0, ""),
            pct("c", 8.0, ""),
            pct("d", 7.0, ""),
            pct("e", 6.0, ""),
            pct("f", 5.0, ""),
            pct("g", 4.0, ""),
        ]
        .join(","),
        "",
    );
    let lines = [line("l1", 1, 100000, &ids[..7]), line("l2", 1, 100000, &["a", "b", "g"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1"), Some(("a", &EmittedValue::Percent(10.0), 10000)));
    assert_eq!(product_of(&plan, "l2"), Some(("a", &EmittedValue::FixedTotal(14000), 14000)));
    // The order stack likewise: 7 order rules in a mesh, 7 % … 1 %, stack the 6 best.
    let orders: Vec<String> =
        ids[..7].iter().enumerate().map(|(k, id)| order_rule(id, &format!(r#"{{"kind": "percentage", "percent": {}}}"#, 7 - k), &mesh_link(&ids[..7], k))).collect();
    let c = rules(&orders.join(","), "");
    let lines = [line("l1", 1, 100000, &[])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let order = plan.order.as_ref().unwrap();
    assert_eq!((order.stack.amount, &order.stack.value), (27000, &EmittedValue::FixedTotal(27000)));
    assert_eq!(order.stack.components.iter().map(|c| plan.rules[c.rule].id).collect::<Vec<_>>(), vec!["a", "b", "c", "d", "e", "f"]);
}

#[test]
fn campaign_overrides_apply_only_for_the_matching_live_variables() {
    let campaign = r#""campaignId": "bf", "campaignVarsVersion": "v1",
        "campaigns": [{"id": "bf", "overrides": [
            {"ruleId": "a", "patch": {"value": {"kind": "percentage", "percent": 30}}},
            {"ruleId": "b", "patch": {"target": {"kind": "products"}}}]}]"#;
    let c = rules(&[pct("a", 10.0, ""), pct("b", 20.0, "")].join(","), campaign);
    let lines = [line("l1", 1, 10000, &["a"]), line("l2", 1, 10000, &["b"]), line("l3", 1, 10000, &["b@bf"])];
    let run = |id: Option<&'static str>, active: bool, version: Option<&'static str>| {
        let mut input = cart(&lines, &[]);
        input.campaign = CampaignInput { id, active, vars_version: version };
        let plan = plan_cart(input, Some(&c));
        let amounts: Vec<i64> = plan.lines.iter().map(|l| l.product.as_ref().map_or(0, |p| p.amount)).collect();
        (plan.campaign_id.map(str::to_string), amounts)
    };
    // Live and matching: 30 % on a; b is re-targeted, so only its campaign-scoped ref counts.
    assert_eq!(run(Some("bf"), true, Some("v1")), (Some("bf".into()), vec![3000, 0, 2000]));
    // Stale version, inactive window, other campaign: the base config.
    assert_eq!(run(Some("bf"), true, Some("stale")), (None, vec![1000, 2000, 0]));
    assert_eq!(run(Some("bf"), false, Some("v1")), (None, vec![1000, 2000, 0]));
    assert_eq!(run(Some("xx"), true, Some("v1")), (None, vec![1000, 2000, 0]));
}

#[test]
fn junk_rules_are_skipped_one_by_one_and_ids_are_unique() {
    let c = rules(
        &[
            r#"{"id": "a", "value": {"kind": "bogus"}, "target": {"kind": "products"}}"#.to_string(),
            pct("a", 10.0, ""),
            pct("a", 50.0, ""),
            r#"{"id": "t", "enabled": true, "value": {"kind": "percentage", "percent": 5}, "target": {"kind": "shelf"}}"#
                .to_string(),
        ]
        .join(","),
        "",
    );
    let lines = [line("l1", 1, 10000, &["a", "t"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.rules.iter().map(|r| r.id).collect::<Vec<_>>(), vec!["a"]);
    assert_eq!(product_of(&plan, "l1").unwrap().2, 1000);
}

#[test]
fn a_missing_or_invalid_config_plans_nothing() {
    let lines = [line("l1", 1, 10000, &["a"])];
    let plan = plan_cart(cart(&lines, &[]), None);
    assert_eq!(plan.reason, Some(PlanFailure::ConfigMissing));
    assert_eq!(emit_for_node(&plan, &NodeRole::Automatic, None), NodeEmission::default());
    let invalid = run_function_with_input(|c: ShopConfig| Ok(c), r#"{"percent": 9}"#).unwrap();
    assert!(invalid.0.is_none());
}

#[test]
fn unnamed_rules_are_described_in_the_cart_language() {
    let unnamed = r#"{"id": "u", "enabled": true, "method": "automatic",
        "value": {"kind": "percentage", "percent": 12.5}, "target": {"kind": "collections"}}"#;
    let c = rules(unnamed, "");
    let lines = [line("l1", 1, 10000, &["u"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.lines[0].product.as_ref().unwrap().message, "12,5\u{A0}% na vybrané kolekce");
    let mut en = cart(&lines, &[]);
    en.locale_en = true;
    let plan = plan_cart(en, Some(&c));
    assert_eq!(plan.lines[0].product.as_ref().unwrap().message, "12.5% off selected collections");
}

#[test]
fn an_entitled_minimum_counts_only_the_rules_own_lines() {
    let c = rules(
        &[
            pct("a", 10.0, r#", "minimum": {"subtotal": {"CZK": 100000}, "quantity": 3}"#),
            pct("e", 5.0, r#", "minimum": {"subtotal": {"CZK": 100000}, "quantity": 3, "scope": "entitled"}"#),
        ]
        .join(","),
        "",
    );
    let mut lines =
        vec![line("l1", 1, 60000, &["a", "e"]), line("l2", 1, 30000, &[]), line("l3", 1, 10000, &["a", "e"]), line("g", 1, 90000, &["a", "e"])];
    lines[2].outlet = true;
    lines[3].gift = true;
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    // The cart: 600 + 300 + 100 (outlet) = 1 000 Kč, 3 items. The rule's own lines: 700 Kč, 2 items.
    assert_eq!(state(&plan, "a"), None);
    assert_eq!(state(&plan, "e"), Some(RuleState::BelowMinimum));
    let enough = [line("l1", 3, 100000, &["e"]), line("l2", 1, 100, &[])];
    let plan = plan_cart(cart(&enough, &[]), Some(&c));
    assert_eq!(state(&plan, "e"), None);
    assert_eq!(product_of(&plan, "l1"), Some(("e", &EmittedValue::Percent(5.0), 15000)));
}

#[test]
fn money_over_the_cap_reads_as_the_cap() {
    let order = r#"{"id": "o", "enabled": true, "name": "o", "method": "automatic",
        "value": {"kind": "fixed", "amount": {"CZK": 9e18}}, "target": {"kind": "order"}}"#;
    let c = rules(order, "");
    let lines = [line("l1", 1, 5_000_000_000_000, &[])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.order.as_ref().unwrap().stack.value, EmittedValue::FixedTotal(1_000_000_000_000));
}

/// The automatic node's lines output, as JSON.stringify would write it.
fn lines_json(plan: &CartPlan, line_count: usize) -> String {
    let emission = emit_for_node(plan, &NodeRole::Automatic, None);
    let mut json = JsonText::default();
    cart_lines_result(&emission, plan, true, true, line_count).write(&mut json).unwrap();
    json.out
}

#[test]
fn a_rounding_tie_is_emitted_as_its_exact_amount() {
    assert!(tie_possible(1005, 10.0) && tie_possible(2750, 1.4) && tie_possible(9990, 15.0));
    assert!(!tie_possible(1004, 10.0) && !tie_possible(0, 50.0));
    // Never a tie just because the amount is large; a genuine half on a large line still is.
    assert!(!tie_possible(50_000_000, 10.0) && !tie_possible(10_000_000, 50.0) && !tie_possible(123_456_789, 10.0));
    assert!(tie_possible(123_456_785, 10.0) && tie_possible(5_000_000_005, 10.0));
    assert!(!tie_possible(3990, 10.0) && !tie_possible(1995, 20.0));
    let order = r#"{"id": "o", "enabled": true, "name": "o", "method": "automatic",
        "value": {"kind": "percentage", "percent": 10}, "target": {"kind": "order"}}"#;
    let c = rules(
        &[pct("t", 10.0, ""), pct("a", 10.0, r#", "combinesWith": {"ruleIds": ["b"]}"#), pct("b", 5.0, ""), order.to_string()].join(","),
        "",
    );
    let lines = [line("l1", 1, 1005, &["t"]), line("l2", 1, 1004, &["t"]), line("l3", 3, 3330, &["a", "b"]), line("l4", 1, 106, &[])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    // l1: 100.5 → 1.01 per item; l2: the percent; l3: 10 % + 5 % of 99.90 = 1 498.5 → 14.99 once;
    // the order: 10 % of 104.05 = 1 040.5 → 10.41.
    assert_eq!(
        lines_json(&plan, lines.len()),
        concat!(
            r#"{"operations":[{"productDiscountsAdd":{"candidates":["#,
            r#"{"message":"t","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"1.01","appliesToEachItem":true}}},"#,
            r#"{"message":"t","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":10}}},"#,
            r#"{"message":"a + b","targets":[{"cartLine":{"id":"l3"}}],"value":{"fixedAmount":{"amount":"14.99","appliesToEachItem":false}}}"#,
            r#"],"selectionStrategy":"ALL"}},{"orderDiscountsAdd":{"candidates":["#,
            r#"{"message":"o","targets":[{"orderSubtotal":{"excludedCartLineIds":[]}}],"value":{"fixedAmount":{"amount":"10.41"}}}"#,
            r#"],"selectionStrategy":"FIRST"}}]}"#,
        )
    );
}

#[test]
fn a_fixed_shipping_amount_goes_to_the_first_delivery_group_only() {
    let groups = vec!["g1".to_string(), "g2".to_string()];
    let lines = [line("l1", 1, 10000, &[])];
    let json = |value: &str| {
        let c = rules(
            &format!(r#"{{"id": "s", "enabled": true, "name": "s", "method": "automatic", "value": {value}, "target": {{"kind": "shipping"}}}}"#),
            "",
        );
        let plan = plan_cart(cart(&lines, &[]), Some(&c));
        let emission = emit_for_node(&plan, &NodeRole::Automatic, None);
        let mut out = JsonText::default();
        delivery_result(&emission, true, &groups, &plan.currency).write(&mut out).unwrap();
        out.out
    };
    assert_eq!(
        json(r#"{"kind": "fixed", "amount": {"CZK": 5000}}"#),
        r#"{"operations":[{"deliveryDiscountsAdd":{"candidates":[{"message":"s","targets":[{"deliveryGroup":{"id":"g1"}}],"value":{"fixedAmount":{"amount":"50.00"}}}],"selectionStrategy":"ALL"}}]}"#
    );
    assert_eq!(
        json(r#"{"kind": "freeShipping"}"#),
        r#"{"operations":[{"deliveryDiscountsAdd":{"candidates":[{"message":"s","targets":[{"deliveryGroup":{"id":"g1"}},{"deliveryGroup":{"id":"g2"}}],"value":{"percentage":{"value":100}}}],"selectionStrategy":"ALL"}}]}"#
    );
}

#[test]
fn over_the_budget_ties_go_back_to_a_percent_before_any_drop() {
    // 200 lines of distinct x.x5 prices at 10 % under a 200-character name: every line a tie, and
    // one exact amount per line is far over the budget. The ties go back to their percent (one
    // candidate) instead of dropping whole lines.
    let name = "Deset ".to_string() + &"Velmi dlouhý název slevy ".repeat(8);
    let c = rules(
        &format!(r#"{{"id": "a", "enabled": true, "name": "{name}", "method": "automatic", "value": {{"kind": "percentage", "percent": 10}}, "target": {{"kind": "products"}}}}"#),
        "",
    );
    let ids: Vec<String> = (1..=200).map(|i| format!("l{i}")).collect();
    let lines: Vec<Line> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| Line { id: Box::leak(id.clone().into_boxed_str()), ..line("", 1, 1005 + 10 * i as i64, &["a"]) })
        .collect();
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let json = lines_json(&plan, lines.len());
    assert_eq!(json.matches(r#""message":"#).count(), 1, "{json}");
    assert_eq!(json.matches(r#""cartLine":"#).count(), 200);
    assert!(json.contains(r#""value":{"percentage":{"value":10}}"#));
}

// --- Margin protection (MVP 2, @won/core margin.ts + plan.ts) --------------------------------

/// A config with these rules and `modules.margin` = `margin` (the compact payload, JSON).
fn margin_rules(rules: &str, margin: &str, extra: &str) -> Config {
    let extra = if extra.is_empty() { String::new() } else { format!(", {extra}") };
    config(&format!(r#"{{"modules": {{"codes": {{"rules": [{rules}]}}, "margin": {margin}}}{extra}}}"#))
}

fn order_rule(id: &str, value: &str, more: &str) -> String {
    format!(r#"{{"id": "{id}", "enabled": true, "name": "{id}", "method": "automatic", "value": {value}, "target": {{"kind": "order"}}{more}}}"#)
}

fn close(actual: Option<f64>, expected: f64, eps: f64) {
    let a = actual.expect("a cost");
    assert!((a - expected).abs() <= eps, "{a} ≈ {expected}");
}

#[test]
fn ceil_tol_ignores_float_noise_and_never_gives_negative_zero() {
    assert_eq!(MARGIN_TOLERANCE, 1e-6);
    assert_eq!(ceil_tol(7.0), 7.0);
    assert_eq!(ceil_tol(7.000001), 7.0);
    assert_eq!(ceil_tol(7.0000011), 8.0);
    assert_eq!(ceil_tol(7.999999), 8.0);
    assert_eq!(ceil_tol(0.0), 0.0);
    // ceil(0.0000005 − 1e-6) is −0 in IEEE: ceilTol gives +0.
    assert!(ceil_tol(0.0000005) == 0.0 && ceil_tol(0.0000005).is_sign_positive());
    // 1 000 × (1 − 0.7) = 300.00000000000006 in floats → 300, not 301.
    assert!(1000.0 * (1.0 - 70.0 / 100.0) > 300.0);
    assert_eq!(ceil_tol(1000.0 * (1.0 - 70.0 / 100.0)), 300.0);
}

#[test]
fn the_floor_is_the_cost_plus_the_minimum_margin_else_the_maximum_discount() {
    let cost = |c: f64, m: f64| margin_floor_unit(100_000, Some(c), m, 50.0);
    assert_eq!(cost(50_000.0, 0.0), (50_000, MarginBasis::Cost));
    assert_eq!(cost(50_000.0, 20.0).0, 62_500);
    // m = 95: 50 000 / 0.050000000000000044 = 999 999.99999999… → 1 000 000; out of range is clamped to 95.
    assert_eq!(cost(50_000.0, 95.0).0, 1_000_000);
    assert_eq!(cost(50_000.0, 100.0).0, 1_000_000);
    assert_eq!(cost(50_000.0, f64::NAN).0, 50_000);
    // A cost above the price: the floor is above the price, never negative.
    assert_eq!(margin_floor_unit(10_000, Some(15_000.0), 0.0, 50.0).0, 15_000);
    let no_cost = |price: i64, p: f64| margin_floor_unit(price, None, 20.0, p);
    assert_eq!(no_cost(999, 50.0), (500, MarginBasis::MaxPercent));
    assert_eq!(no_cost(999, 0.0).0, 999);
    assert_eq!(no_cost(999, 100.0).0, 0);
    assert_eq!(no_cost(1000, 70.0).0, 300);
    assert_eq!(no_cost(1000, f64::NAN).0, 500);
    assert_eq!(margin_floor_unit(1000, Some(0.0), 0.0, 40.0).1, MarginBasis::MaxPercent);
    assert_eq!(margin_floor_unit(100, Some(1e12), 95.0, 50.0).0, 1_000_000_000_000);
}

#[test]
fn a_cost_is_known_only_in_the_shop_currency_and_converts_with_the_rate() {
    close(cost_minor_units(Some(12.34), Some("CZK"), None, "CZK", Some("CZK")), 1234.0, 1e-9);
    // The shop currency: the rate is ignored (1).
    close(cost_minor_units(Some(12.34), Some("CZK"), Some(0.04), "CZK", Some("CZK")), 1234.0, 1e-6);
    assert_eq!(cost_minor_units(None, Some("CZK"), Some(1.0), "CZK", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(0.0), Some("CZK"), Some(1.0), "CZK", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(-5.0), Some("CZK"), Some(1.0), "CZK", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(10.0), Some("EUR"), Some(1.0), "CZK", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(10.0), None, Some(1.0), "CZK", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(10.0), Some("CZK"), Some(1.0), "CZK", None), None);
    // Another cart currency needs a finite rate > 0 (shop → cart).
    close(cost_minor_units(Some(100.0), Some("CZK"), Some(0.04), "EUR", Some("CZK")), 400.0, 1e-9);
    assert_eq!(cost_minor_units(Some(100.0), Some("CZK"), None, "EUR", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(100.0), Some("CZK"), Some(0.0), "EUR", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(100.0), Some("CZK"), Some(-1.0), "EUR", Some("CZK")), None);
    assert_eq!(cost_minor_units(Some(100.0), Some("CZK"), Some(f64::INFINITY), "EUR", Some("CZK")), None);
    // Minor units of the CART currency: JPY 0, KWD 3.
    close(cost_minor_units(Some(100.0), Some("CZK"), Some(6.5), "JPY", Some("CZK")), 650.0, 1e-9);
    close(cost_minor_units(Some(1.2345), Some("KWD"), None, "KWD", Some("KWD")), 1234.5, 1e-6);
    // Capped at the money cap, never Infinity.
    assert_eq!(cost_minor_units(Some(1e300), Some("CZK"), Some(1e300), "EUR", Some("CZK")), Some(1e12));
}

#[test]
fn the_margin_payload_is_read_tolerantly_and_off_unless_exactly_on() {
    let read = |json: &str| run_function_with_input(|c: ShopConfig| Ok(c), &format!(r#"{{"modules": {{"codes": {{"rules": []}}, "margin": {json}}}}}"#)).unwrap().0.unwrap().margin;
    for off in [
        r#"{"enabled": false, "max": 50}"#,
        r#"{"enabled": "true", "max": 50}"#,
        r#"{"enabled": true}"#,
        r#"{"enabled": true, "max": "50"}"#,
        r#"{"global": {"maxDiscountPercent": 10}, "perCollection": []}"#,
        r#"[{"enabled": true, "max": 50}]"#,
        "null",
    ] {
        assert_eq!(read(off), None, "{off}");
    }
    let on = read(
        r#"{"enabled": true, "max": 140, "min": -5, "cur": "czk",
            "col": {"1": [120, null], "2": [null, -1], "3": [5], "4": ["x", 5], "5": [null, null], "6": 7}}"#,
    )
    .unwrap();
    assert_eq!((on.min, on.max, on.cur.as_deref()), (Some(0.0), 100.0, None));
    let col: Vec<_> = on.col.entries().into_iter().map(|(k, m, p)| (k, (m, p))).collect();
    let col: Vec<_> = col.iter().map(|(k, v)| (k.as_str(), *v)).collect();
    assert_eq!(col, vec![("1", (Some(95.0), None)), ("2", (None, Some(0.0))), ("5", (None, None))]);
    let eur = read(r#"{"enabled": true, "max": 30, "min": "x", "cur": "EUR"}"#).unwrap();
    assert_eq!((eur.min, eur.max, eur.cur.as_deref(), eur.col.len()), (None, 30.0, Some("EUR"), 0));
}

#[test]
fn a_product_takes_the_strictest_of_its_collections_settings() {
    let read = |json: &str| {
        run_function_with_input(|c: ShopConfig| Ok(c), &format!(r#"{{"modules": {{"codes": {{"rules": []}}, "margin": {json}}}}}"#))
            .unwrap()
            .0
            .unwrap()
            .margin
            .unwrap()
    };
    let payload = read(r#"{"enabled": true, "min": 10, "max": 50, "col": {"1": [30, null], "2": [null, 10], "3": [null, null]}}"#);
    let settings = |refs: &[&str]| {
        let refs: Vec<MarginRef> = refs.iter().map(|r| MarginRef::from(*r)).collect();
        let s = resolve_margin(&payload, &refs);
        (s.min_margin_percent, s.max_discount_percent, s.collection)
    };
    assert_eq!(settings(&[]), (10.0, 50.0, false));
    assert_eq!(settings(&["1"]), (30.0, 50.0, true));
    assert_eq!(settings(&["1", "2"]), (30.0, 10.0, true));
    assert_eq!(settings(&["2", "1"]), (30.0, 10.0, true));
    assert_eq!(settings(&["3"]), (10.0, 50.0, true));
    assert_eq!(settings(&["99"]), (10.0, 50.0, false));
    // No `min`: 0 (never below the cost). A "__proto__" key never matches (JS object semantics).
    let bare = read(r#"{"enabled": true, "max": 40, "col": {"__proto__": [90, 0], "7": [null, 5]}}"#);
    let s = resolve_margin(&bare, &[MarginRef::from("__proto__")]);
    assert_eq!((s.min_margin_percent, s.max_discount_percent, s.collection), (0.0, 40.0, false));
    let s = resolve_margin(&bare, &[MarginRef::from("7")]);
    assert_eq!((s.min_margin_percent, s.max_discount_percent, s.collection), (0.0, 5.0, true));
    // A key matches a ref only by its exact text: numeric ids are read as numbers,
    // so "007", "+7", " 7", "7.0" and 20-digit ids (past u64) must stay texts.
    let texts = read(
        r#"{"enabled": true, "max": 50, "col": {"007": [1, null], "7": [2, null], "0": [3, null], "7.0": [4, null],
            "18446744073709551616": [5, null], "18446744073709551615": [6, null], "abc": [7, null], "": [8, null]}}"#,
    );
    let min_of = |r: &str| {
        let s = resolve_margin(&texts, &[MarginRef::from(r)]);
        s.collection.then_some(s.min_margin_percent)
    };
    let got: Vec<_> = ["007", "7", "0", "7.0", "18446744073709551616", "18446744073709551615", "abc", "", "00", "+7", " 7", "1844674407370955161"]
        .iter()
        .map(|r| min_of(r))
        .collect();
    assert_eq!(got, vec![Some(1.0), Some(2.0), Some(3.0), Some(4.0), Some(5.0), Some(6.0), Some(7.0), Some(8.0), None, None, None, None]);
}

#[test]
fn margin_off_plans_exactly_like_mvp1() {
    let rules_json = [pct("a", 60.0, ""), order_rule("o", r#"{"kind": "percentage", "percent": 30}"#, "")].join(",");
    let mut with_costs = vec![line("l1", 2, 100_000, &["a"]), line("l2", 1, 30_000, &[])];
    for l in &mut with_costs {
        l.cost = Some(900.0);
        l.cur = Some("CZK");
        l.margin_refs = vec!["1".into()];
    }
    let bare = [line("l1", 2, 100_000, &["a"]), line("l2", 1, 30_000, &[])];
    let plain = rules(&rules_json, "");
    let mvp1 = plan_cart(cart(&bare, &[]), Some(&plain)).lines.clone();
    for margin in [r#"{"enabled": false}"#, r#"{"global": {"maxDiscountPercent": 10}, "perCollection": []}"#] {
        let c = margin_rules(&rules_json, margin, "");
        let mut input = cart(&with_costs, &[]);
        input.shop_to_cart_rate = Some(1.0);
        let plan = plan_cart(input, Some(&c));
        assert_eq!(plan.lines, mvp1, "{margin}");
        let order = plan.order.as_ref().unwrap();
        assert_eq!((order.stack.amount, order.base, order.excluded_line_ids.len()), (33_000, 110_000, 0));
        assert_eq!(order.stack.value, EmittedValue::Percent(30.0));
    }
}

#[test]
fn a_product_line_is_cut_to_its_headroom_and_emitted_as_that_exact_amount() {
    let fixed = r#"{"id": "f", "enabled": true, "name": "f", "method": "automatic",
        "value": {"kind": "fixed", "amount": {"CZK": 30000}}, "target": {"kind": "products"}}"#;
    let c = margin_rules(&[pct("a", 30.0, ""), fixed.to_string()].join(","), r#"{"enabled": true, "min": 20, "max": 50, "cur": "CZK"}"#, "");
    let lines = [
        cost_line("l1", 1, 100_000, 700.0, &["a"]),
        line("l2", 2, 20_000, &["a"]),
        line("l3", 3, 50_000, &["f"]),
        cost_line("l4", 1, 100_000, 1000.0, &["a"]),
    ];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    // Floor 700 / 0.8 = 875 Kč → headroom 125 Kč of the 300 Kč.
    assert_eq!(product_of(&plan, "l1"), Some(("a", &EmittedValue::FixedTotal(12_500), 12_500)));
    assert!(plan.lines[0].margin_capped);
    // No cost: the 50 % ceiling leaves the 30 % alone.
    assert_eq!(product_of(&plan, "l2"), Some(("a", &EmittedValue::Percent(30.0), 12_000)));
    assert!(!plan.lines[1].margin_capped);
    // A fixed amount per item is capped on the whole line: 1 500 − 3 × 250 = 750 Kč.
    assert_eq!(product_of(&plan, "l3"), Some(("f", &EmittedValue::FixedTotal(75_000), 75_000)));
    // At the floor already: no product discount at all.
    assert_eq!(product_of(&plan, "l4"), None);
    assert!(plan.lines[3].margin_capped);
    assert_eq!(
        lines_json(&plan, lines.len()),
        concat!(
            r#"{"operations":[{"productDiscountsAdd":{"candidates":["#,
            r#"{"message":"a","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"125.00","appliesToEachItem":true}}},"#,
            r#"{"message":"a","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":30}}},"#,
            r#"{"message":"f","targets":[{"cartLine":{"id":"l3"}}],"value":{"fixedAmount":{"amount":"250.00","appliesToEachItem":true}}}"#,
            r#"],"selectionStrategy":"ALL"}}]}"#,
        )
    );
    // A capped stack whose total equals its summed percent stays an exact amount: 10,05 Kč, 10 % + 10 %, 20 % ceiling.
    let c = margin_rules(&[pct("x", 10.0, r#", "combinesWith": {"ruleIds": ["y"]}"#), pct("y", 10.0, "")].join(","), r#"{"enabled": true, "max": 20}"#, "");
    let lines = [line("l1", 1, 1005, &["x", "y"])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(plan.lines[0].product.as_ref().unwrap().amount, 201);
    assert!(lines_json(&plan, 1).contains(r#""value":{"fixedAmount":{"amount":"2.01","appliesToEachItem":true}}"#));
}

#[test]
fn a_cost_in_another_cart_currency_converts_with_the_rate_else_the_ceiling_applies() {
    let c = margin_rules(&pct("a", 60.0, ""), r#"{"enabled": true, "min": 10, "max": 30, "cur": "CZK"}"#, "");
    let lines = [cost_line("l1", 1, 4000, 500.0, &["a"])];
    let run = |rate: Option<f64>| {
        let mut input = cart(&lines, &[]);
        input.currency = "EUR".into();
        input.shop_to_cart_rate = rate;
        plan_cart(input, Some(&c)).lines[0].product.as_ref().map(|p| p.amount)
    };
    // 500 CZK × 0.04 = 20 € → floor 20 / 0.9 = 22,23 € → 17,77 €.
    assert_eq!(run(Some(0.04)), Some(1777));
    // No usable rate: the cost is unknown, the 30 % ceiling applies (floor 28 €).
    assert_eq!(run(None), Some(1200));
    assert_eq!(run(Some(0.0)), Some(1200));
}

#[test]
fn a_pro_stack_is_cut_in_rank_order_and_its_owner_recomputed() {
    let rules_json = [pct("a", 20.0, r#", "combinesWith": {"ruleIds": ["b"]}"#), code("b", 10.0, WELCOME15, "")].join(",");
    let lines = [line("l1", 1, 100_000, &["a", "b"])];
    let c = margin_rules(&rules_json, r#"{"enabled": true, "max": 25}"#, "");
    let wide = plan_cart(cart(&lines, &["WELCOME15"]), Some(&c));
    let stack = wide.lines[0].product.as_ref().unwrap();
    let parts: Vec<(&str, i64)> = stack.components.iter().map(|c| (wide.rules[c.rule].id, c.amount)).collect();
    assert_eq!(parts, vec![("a", 20_000), ("b", 5_000)]);
    assert_eq!((wide.rules[stack.owner].id, &stack.value, stack.message.as_ref()), ("b", &EmittedValue::FixedTotal(25_000), "a + b"));
    let c = margin_rules(&rules_json, r#"{"enabled": true, "max": 15}"#, "");
    let tight = plan_cart(cart(&lines, &["WELCOME15"]), Some(&c));
    let stack = tight.lines[0].product.as_ref().unwrap();
    let parts: Vec<(&str, i64)> = stack.components.iter().map(|c| (tight.rules[c.rule].id, c.amount)).collect();
    assert_eq!(parts, vec![("a", 15_000)]);
    assert_eq!((tight.rules[stack.owner].id, stack.message.as_ref()), ("a", "a"));
    assert_eq!(emit_for_node(&tight, &NodeRole::Automatic, None).product[0].amount, 15_000);
    assert!(emit_for_node(&tight, &NodeRole::Code("b".into()), Some("WELCOME15")).product.is_empty());
}

#[test]
fn the_order_discount_is_safe_on_both_allocation_bases_with_a_reserve() {
    let percent = |p: f64| format!(r#"{{"kind": "percentage", "percent": {p}}}"#);
    // After the 50 % product discount line 1 is 500 Kč, floor 400 Kč: 199,98 on the after-product
    // base, but only 149,98 on the before-product base (line 1 is 1 000 of 1 500).
    let c = margin_rules(&[pct("a", 50.0, ""), order_rule("o", &percent(20.0), "")].join(","), r#"{"enabled": true, "max": 60}"#, "");
    let lines = [line("l1", 1, 100_000, &["a"]), line("l2", 1, 50_000, &[])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert_eq!(product_of(&plan, "l1").unwrap().2, 50_000);
    let order = plan.order.as_ref().unwrap();
    assert_eq!((order.stack.amount, &order.stack.value, order.base), (14_998, &EmittedValue::FixedTotal(14_998), 100_000));
    assert!(order.excluded_line_ids.is_empty());
    // One line, 30 % wanted, 20 % ceiling: 199,99 (1 haléř kept for rounding).
    let c = margin_rules(&order_rule("o", &percent(30.0), ""), r#"{"enabled": true, "max": 20}"#, "");
    let one = [line("l1", 1, 100_000, &[])];
    let order = plan_cart(cart(&one, &[]), Some(&c)).order.unwrap();
    assert_eq!(order.stack.value, EmittedValue::FixedTotal(19_999));
    // Two orderings: A (1 000 Kč, 90 % off → 100 Kč, floor 49,99) and B (100 Kč, floor 94,99) share
    // k = h/s = 0,05, so by h/s {A, B} is the only candidate (B's share limits D to 10 Kč); by h/a
    // (A 0,5, B 0,05) {A} alone carries the whole 50 % of 100 Kč, which is more: B is left out.
    let c = margin_rules(&[pct("p", 90.0, ""), order_rule("o", &percent(50.0), "")].join(","), r#"{"enabled": true, "max": 100, "cur": "CZK"}"#, "");
    let same_k = [cost_line("a", 1, 100_000, 49.99, &["p"]), cost_line("b", 1, 10_000, 94.99, &[])];
    let plan = plan_cart(cart(&same_k, &[]), Some(&c));
    let order = plan.order.as_ref().unwrap();
    assert_eq!((order.stack.amount, &order.stack.value, order.base), (5000, &EmittedValue::Percent(50.0), 10_000));
    assert_eq!(order.excluded_line_ids, vec!["b"]);
}

#[test]
fn lines_at_their_floor_are_left_out_of_the_order_discount() {
    let percent = r#"{"kind": "percentage", "percent": 10}"#;
    let margin = r#"{"enabled": true, "max": 50, "cur": "CZK"}"#;
    let c = margin_rules(&order_rule("o", percent, ""), margin, "");
    let lines = [line("l1", 1, 100_000, &[]), cost_line("l2", 1, 100_000, 1000.0, &[]), line("l3", 1, 50_000, &[])];
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let order = plan.order.as_ref().unwrap();
    // Still 10 %, now of lines 1 and 3 only.
    assert_eq!((order.stack.amount, &order.stack.value, order.base), (15_000, &EmittedValue::Percent(10.0), 150_000));
    assert_eq!(order.excluded_line_ids, vec!["l2"]);
    assert_eq!(emit_for_node(&plan, &NodeRole::Automatic, None).order[0].excluded_line_ids, &["l2"]);
    // A fixed amount the other lines carry whole is unchanged; equal D → the larger set (nothing left out for nothing).
    let c = margin_rules(&order_rule("o", r#"{"kind": "fixed", "amount": {"CZK": 10000}}"#, ""), margin, "");
    let floored = [line("l1", 1, 100_000, &[]), cost_line("l2", 1, 100_000, 1000.0, &[])];
    let order = plan_cart(cart(&floored, &[]), Some(&c)).order.unwrap();
    assert_eq!((order.stack.value, order.excluded_line_ids), (EmittedValue::FixedTotal(10_000), vec!["l2"]));
    let both = [line("l1", 1, 100_000, &[]), line("l2", 1, 20_000, &[])];
    let order = plan_cart(cart(&both, &[]), Some(&c)).order.unwrap();
    assert_eq!((order.stack.amount, order.base, order.excluded_line_ids.len()), (10_000, 120_000, 0));
    // Every line at its floor: no order discount; shipping is outside margin protection.
    let ship = r#"{"id": "s", "enabled": true, "name": "s", "method": "automatic", "value": {"kind": "freeShipping"}, "target": {"kind": "shipping"}}"#;
    let c = margin_rules(&[order_rule("o", percent, ""), ship.to_string()].join(","), margin, "");
    let at_floor = [cost_line("l1", 1, 100_000, 1000.0, &[])];
    let plan = plan_cart(cart(&at_floor, &[]), Some(&c));
    assert!(plan.order.is_none());
    assert_eq!(plan.rules[plan.shipping.as_ref().unwrap().rule].id, "s");
}

#[test]
fn exclusive_mode_protects_the_order_only_scenario_too() {
    let off = r#""engine": {"combination": {"productWithOrder": false}}"#;
    let order = order_rule("o", r#"{"kind": "percentage", "percent": 30}"#, "");
    let lines = [line("l1", 1, 100_000, &["a"]), cost_line("l2", 1, 100_000, 1000.0, &[])];
    // Order only: line 2 left out, line 1 gives 99,99 Kč > the 50 Kč product scenario.
    let c = margin_rules(&[pct("a", 5.0, ""), order.clone()].join(","), r#"{"enabled": true, "max": 10, "cur": "CZK"}"#, off);
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let o = plan.order.as_ref().unwrap();
    assert_eq!((o.stack.amount, &o.stack.value, o.excluded_line_ids.clone()), (9_999, &EmittedValue::FixedTotal(9_999), vec!["l2"]));
    assert!(plan.lines.iter().all(|l| l.product.is_none()));
    // More headroom on the product side: the products win, no order discount.
    let c = margin_rules(&[pct("a", 50.0, ""), order].join(","), r#"{"enabled": true, "max": 60, "cur": "CZK"}"#, off);
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    assert!(plan.order.is_none());
    assert_eq!(product_of(&plan, "l1").unwrap().2, 50_000);
}

#[test]
fn campaign_overrides_apply_first_then_margin_protection() {
    let campaign = r#""campaignId": "bf", "campaignVarsVersion": "v1",
        "campaigns": [{"id": "bf", "overrides": [{"ruleId": "a", "patch": {"value": {"kind": "percentage", "percent": 70}}}]}]"#;
    let c = margin_rules(&pct("a", 10.0, ""), r#"{"enabled": true, "max": 40}"#, campaign);
    let lines = [line("l1", 1, 100_000, &["a"])];
    let mut input = cart(&lines, &[]);
    input.campaign = CampaignInput { id: Some("bf"), active: true, vars_version: Some("v1") };
    let plan = plan_cart(input, Some(&c));
    assert_eq!(plan.campaign_id, Some("bf"));
    assert_eq!(product_of(&plan, "l1"), Some(("a", &EmittedValue::FixedTotal(40_000), 40_000)));
}

#[test]
fn a_capped_line_is_never_relaxed_over_the_output_budget() {
    // 200 stacks of different amounts (fixed per item + 10 %), over the budget, with a 20 % ceiling
    // that caps the cheaper lines: the uncapped stacks degrade to their top rule, the capped ones
    // keep their exact amount (or are dropped).
    let c = margin_rules(
        &[
            r#"{"id": "fix", "enabled": true, "name": "9,99 Kč z kusu", "method": "automatic", "value": {"kind": "fixed", "amount": {"CZK": 999}},
                "target": {"kind": "products"}, "combinesWith": {"ruleIds": ["ten"]}}"#
                .to_string(),
            pct("ten", 10.0, ""),
        ]
        .join(","),
        r#"{"enabled": true, "max": 20}"#,
        "",
    );
    let ids: Vec<String> = (1..=200).map(|i| format!("L{i}")).collect();
    let lines: Vec<Line> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| Line { id: Box::leak(id.clone().into_boxed_str()), ..line("", 1, 5000 + (i as i64 + 1) * 101, &["fix", "ten"]) })
        .collect();
    let plan = plan_cart(cart(&lines, &[]), Some(&c));
    let capped: Vec<&str> = plan.lines.iter().filter(|l| l.margin_capped).map(|l| l.line_id).collect();
    assert!(capped.len() > 20 && capped.len() < 200, "{} capped lines", capped.len());
    let emission = emit_for_node(&plan, &NodeRole::Automatic, None);
    let result = cart_lines_result(&emission, &plan, true, true, lines.len());
    let mut json = JsonText::counter();
    result.write(&mut json).unwrap();
    assert!(json.bytes <= 19_000, "{} B", json.bytes);
    let CartOperation::ProductDiscountsAdd(candidates) = &result.operations[0] else { panic!("product candidates") };
    let mut percents = 0;
    for c in candidates {
        let on_capped = c.targets.iter().any(|t| capped.contains(t));
        if on_capped {
            assert!(matches!(c.value, ProductValue::FixedAmount { .. }), "{c:?}");
        }
        percents += usize::from(matches!(c.value, ProductValue::Percentage(_)));
    }
    assert!(percents > 0, "the uncapped stacks degraded to their top rule (10 %)");
}

/// A search line (minor units): (after, before, headroom).
fn set_line(after: i64, before: i64, headroom: i64) -> OrderSetLine {
    OrderSetLine { after, before, headroom }
}

fn order_set(members: &[usize], amount: i64, base: i64, wanted: i64) -> OrderSet {
    OrderSet { members: members.to_vec(), amount, base, wanted }
}

#[test]
fn order_search_groups_equal_keys_searches_both_orderings_and_the_better_d_wins() {
    // A a=10 000 s=100 000 h=5 000; B a=s=10 000 h=500: equal h/s, so by h/s they enter together.
    let lines = [set_line(10_000, 100_000, 5_000), set_line(10_000, 10_000, 500)];
    let fifty_percent = |base: i64| (js_round_half(base, 50.0)).min(base);
    let search = search_order_sets(&lines, &fifty_percent);
    assert_eq!(search.by_before, order_set(&[0, 1], 1_000, 20_000, 10_000));
    assert_eq!(search.by_after, order_set(&[0], 5_000, 10_000, 5_000));
    assert!(search.after_wins && !search.after_skipped);
    assert_eq!(search.best(), &search.by_after);
}

#[test]
fn order_search_ties_go_to_the_larger_set_then_to_the_h_s_set() {
    // h/s allows 30 on line 0 alone, h/a 30 on lines 0, 2 and 3: the larger set.
    let lines = [set_line(98, 140, 47), set_line(30, 30, 3), set_line(65, 130, 11), set_line(40, 100, 10)];
    let up_to_30 = |base: i64| base.min(30);
    let larger = search_order_sets(&lines, &up_to_30);
    assert_eq!((larger.by_before.members.clone(), larger.by_before.amount), (vec![0], 30));
    assert_eq!((larger.by_after.members.clone(), larger.by_after.amount), (vec![0, 2, 3], 30));
    assert!(larger.after_wins);
    // Same D, same size, different sets (a synthetic wanted: only a base of 10 wants 5):
    // h/s picks Y alone, h/a picks X alone → the h/s set.
    let only_ten = |base: i64| if base == 10 { 5 } else { 0 };
    let tie = search_order_sets(&[set_line(10, 20, 9), set_line(10, 10, 5)], &only_ten);
    assert_eq!(tie.by_before, order_set(&[1], 5, 10, 5));
    assert_eq!(tie.by_after, order_set(&[0], 5, 10, 5));
    assert!(!tie.after_wins);
    assert_eq!(tie.best(), &tie.by_before);
    // No product discounts (a = s): the h/a ordering is the h/s one — not searched again, the same set.
    let plain = [set_line(1000, 1000, 400), set_line(500, 500, 30), set_line(800, 800, 30)];
    let ten_percent = |base: i64| js_round_half(base, 10.0).min(base);
    let same = search_order_sets(&plain, &ten_percent);
    assert!(same.after_skipped && !same.after_wins);
    assert_eq!(same.by_after, same.by_before);
    assert_eq!(same.by_before, order_set(&[0], 100, 1000, 100));
}

/// `Math.round((base × p) / 100)` of an order percent.
fn js_round_half(base: i64, percent: f64) -> i64 {
    super::js::round((base as f64 * percent) / 100.0) as i64
}
