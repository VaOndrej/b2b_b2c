// `cart.lines.discounts.generate.run`: every Won node plans the whole cart and
// emits only its own product and order candidates. A node without the PRODUCT
// or ORDER class, an unknown role or a missing/invalid shared config emits no
// operations; nothing here fails, so checkout is never blocked by this function.

use crate::engine::emit::emit_for_node;
use crate::engine::plan::plan_cart;
use crate::output::{cart_lines_result, CartLinesResult};
use crate::schema;
use shopify_function::Result;

pub fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<CartLinesResult> {
    let classes = input.discount().discount_classes();
    let product = classes.contains(&schema::DiscountClass::Product);
    let order = classes.contains(&schema::DiscountClass::Order);
    if !product && !order {
        return Ok(CartLinesResult::default());
    }
    let Some(adapted) = crate::adapt_input!(&input, cart_lines_discounts_generate_run) else {
        return Ok(CartLinesResult::default());
    };
    let plan = plan_cart(adapted.cart, Some(adapted.config));
    let emission = emit_for_node(&plan, &adapted.role, adapted.triggering_code);
    Ok(cart_lines_result(&emission, &plan, product, order, input.cart().lines().len()))
}
