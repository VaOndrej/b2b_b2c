// `cart.lines.discounts.generate.run`: every Won node plans the whole cart and
// emits only its own product and order candidates. A node without the PRODUCT
// or ORDER class, an unknown role or a missing/invalid shared config emits no
// operations; nothing here fails, so checkout is never blocked by this function.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::output::{cart_lines_result, CartLinesResult, Sink};
use crate::schema;
use shopify_function::wasm_api::write::Error;

/// Plans the cart and writes the node's output to `out` while the input lives
/// (the output borrows its text from the plan and the input). Nothing the run
/// built is dropped: the run's memory is thrown away after it (src/main.rs).
pub fn cart_lines_discounts_generate_run<S: Sink>(input: schema::cart_lines_discounts_generate_run::Input, out: &mut S) -> Result<(), Error> {
    let classes = input.discount().discount_classes();
    let product = classes.contains(&schema::DiscountClass::Product);
    let order = classes.contains(&schema::DiscountClass::Order);
    if !product && !order {
        return CartLinesResult::default().write(out);
    }
    let Some(adapted) = crate::adapt_input!(&input, cart_lines_discounts_generate_run) else {
        return CartLinesResult::default().write(out);
    };
    let plan = plan_cart(adapted.cart, Some(adapted.config));
    let emission = emit_for_node(&plan, &adapted.role, adapted.triggering_code);
    let result = cart_lines_result(&emission, &plan, product, order, input.cart().lines().len());
    let written = result.write(out);
    std::mem::forget(result);
    std::mem::forget(emission);
    std::mem::forget(plan);
    std::mem::forget(adapted.role);
    std::mem::forget(input);
    written
}
