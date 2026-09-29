// The Won discount engine, the part the function runs: a port of @won/core
// packages/core/src/discounts/{cart,plan,margin,emit,code-hash,money}.ts (+ the
// short rule description of describe.ts for unnamed rules' messages). Pure Rust
// over plain data; only config.rs and margin.rs (the shared config) read the
// input (through src/json.rs).

pub mod cart;
pub mod config;
pub mod describe;
pub mod emit;
pub mod fnv;
pub mod hash;
pub mod js;
pub mod margin;
pub mod money;
pub mod order_search;
pub mod plan;

#[cfg(test)]
mod tests;
