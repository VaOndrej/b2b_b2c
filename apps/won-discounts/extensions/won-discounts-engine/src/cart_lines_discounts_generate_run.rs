// `cart.lines.discounts.generate.run`: every Won node plans the whole cart and
// emits only its own product and order candidates. A node without the PRODUCT
// or ORDER class, an unknown role or a missing/invalid shared config emits no
// operations; nothing here fails, so checkout is never blocked by this function.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::input::{node, RunInput};
use crate::output::{cart_lines_result, CartLinesResult, Sink};
use shopify_function::wasm_api::write::Error;
use shopify_function::wasm_api::Value;

/// Plans the cart and writes the node's output to `out` while the input lives
/// (the output borrows its text from the plan and the input). Nothing the run
/// built is dropped: the run's memory is thrown away after it (src/main.rs).
pub fn cart_lines_discounts_generate_run<S: Sink>(input: Value, out: &mut S) -> Result<(), Error> {
    let (discount, classes) = node(&input);
    if !classes.product && !classes.order {
        return CartLinesResult::default().write(out);
    }
    let Some(run) = RunInput::read(&input, &discount) else {
        return CartLinesResult::default().write(out);
    };
    let plan = plan_cart(run.cart(), Some(&run.config));
    let emission = emit_for_node(&plan, &run.role, run.triggering_code.as_deref());
    let result = cart_lines_result(&emission, &plan, classes.product, classes.order, run.line_count);
    let written = result.write(out);
    std::mem::forget(result);
    std::mem::forget(emission);
    std::mem::forget(plan);
    std::mem::forget(run);
    written
}
