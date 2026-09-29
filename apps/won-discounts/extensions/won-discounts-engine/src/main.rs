// won-discounts-engine: the Won Discounts discount function (MVP 1, margin protection MVP 2), in Rust.
//
// The production hot path. The reference is the TypeScript engine in
// @won/core (packages/core/src/discounts): cart.ts → plan.ts → emit.ts, plus
// the adapter tests/reference-adapter.js. This crate reproduces exactly what
// the FUNCTION needs of it (no explain/describe beyond the checkout message)
// and is held to the same fixtures (tests/fixtures, generated from the TS
// engine; README.md "Parity").
//
//   input (lazy, src/input.rs) → engine::cart::CartInput + engine::config::Config
//   → engine::plan::plan_cart → engine::emit::emit_for_node → src/output.rs
//
// Never panics on input DATA: every JSON value is read by the tolerant readers
// in src/json.rs; anything unexpected is read as "nothing", and a missing or
// invalid shared config plans nothing (no operations, checkout never blocked).

use shopify_function::prelude::*;
use shopify_function::wasm_api::{Context, Deserialize};
use std::process;

#[cfg(target_arch = "wasm32")]
mod alloc;
pub mod cart_delivery_options_discounts_generate_run;
pub mod cart_lines_discounts_generate_run;
pub mod engine;
pub mod input;
pub mod json;
pub mod output;

#[cfg(test)]
mod fixture_tests;

#[typegen("schema.graphql")]
pub mod schema {
    #[query(
        "src/cart_lines_discounts_generate_run.graphql",
        custom_scalar_overrides = {
            "Input.discount.vars.jsonValue" => super::json::NodeVars,
            "Input.shop.config.jsonValue" => super::json::ShopConfig,
            "Input.cart.lines.cost.amountPerQuantity.amount" => super::json::DecimalText,
            "Input.cart.lines.merchandise.product.wonProduct.jsonValue" => super::json::WonProduct,
            "Input.cart.lines.merchandise.wonVariant.jsonValue" => super::json::WonVariant,
            "Input.presentmentCurrencyRate" => super::json::DecimalNumber,
        }
    )]
    pub mod cart_lines_discounts_generate_run {}

    #[query(
        "src/cart_delivery_options_discounts_generate_run.graphql",
        custom_scalar_overrides = {
            "Input.discount.vars.jsonValue" => super::json::NodeVars,
            "Input.shop.config.jsonValue" => super::json::ShopConfig,
            "Input.cart.lines.cost.amountPerQuantity.amount" => super::json::DecimalText,
            "Input.cart.lines.merchandise.product.wonProduct.jsonValue" => super::json::WonProduct,
            "Input.cart.lines.merchandise.wonVariant.jsonValue" => super::json::WonVariant,
            "Input.presentmentCurrencyRate" => super::json::DecimalNumber,
        }
    )]
    pub mod cart_delivery_options_discounts_generate_run {}
}

/// What `#[shopify_function]` generates, by hand: the extension keeps the export
/// names of its JS version (`cart-lines-discounts-generate-run`, …: the toml,
/// the fixtures and the deployed function identity), and a Rust function name
/// cannot contain a dash. The run functions write their output themselves, while
/// the input lives (the output borrows its text from it). They never fail on
/// input data; a failure to read the root or to write the output (not reachable
/// with well-formed output) is dropped rather than panicking. What a run built is
/// never dropped: the run's memory is thrown away after it, and walking it to
/// free it only costs instructions (src/alloc.rs).
fn run_export<I: Deserialize>(run: fn(I, &mut Context) -> Result<(), shopify_function::wasm_api::write::Error>) {
    shopify_function::wasm_api::init_panic_handler();
    let mut context = Context::new();
    let Ok(root) = context.input_get() else { return };
    let Ok(input) = I::deserialize(&root) else { return };
    let _ = run(input, &mut context);
}

#[export_name = "cart-lines-discounts-generate-run"]
pub extern "C" fn cart_lines_discounts_generate_run_export() {
    run_export(cart_lines_discounts_generate_run::cart_lines_discounts_generate_run::<Context>);
}

#[export_name = "cart-delivery-options-discounts-generate-run"]
pub extern "C" fn cart_delivery_options_discounts_generate_run_export() {
    run_export(cart_delivery_options_discounts_generate_run::cart_delivery_options_discounts_generate_run::<Context>);
}

fn main() {
    log!("Please invoke a named export.");
    process::abort();
}
