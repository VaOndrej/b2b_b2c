// The Won discount engine, the part the function runs: a port of @won/core
// packages/core/src/discounts/{cart,plan,plan-tiers,tiers,margin,emit,code-hash,code-batch,money}.ts
// (+ the short rule description of describe.ts for unnamed rules' messages and
// the tier break's for a quantity tier's). Pure Rust over plain data; only
// config.rs and margin.rs (the shared config) read the input (through
// src/json.rs).

pub mod batch;
pub mod cart;
pub mod config;
pub mod describe;
pub mod emit;
pub mod hash;
pub mod js;
pub mod margin;
pub mod money;
pub mod order_search;
pub mod plan;
pub mod table;
pub mod tiers;
mod upper_table;

#[cfg(test)]
mod tests;
