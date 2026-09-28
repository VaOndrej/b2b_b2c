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
use super::plan::{plan_cart, CartPlan, EmittedValue, Excluded, PlanFailure, RuleState, ShippingValue};
use crate::json::ShopConfig;

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
}

fn line(id: &'static str, qty: i64, price: i64, refs: &[&str]) -> Line {
    Line { id, qty, price, refs: refs.iter().map(|r| r.to_string()).collect(), outlet: false, gift: false }
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
                variant_rule_ids: Vec::new(),
            })
            .collect(),
        entered_codes: codes.to_vec(),
        campaign: CampaignInput::default(),
        today: Some("2026-10-01"),
        locale_en: false,
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
