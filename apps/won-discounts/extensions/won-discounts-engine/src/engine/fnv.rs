// A tiny FNV-1a hasher for the engine's lookup maps: std's SipHash is needlessly
// slow for short keys under Shopify's instruction limit. The maps are only ever
// looked up, never iterated, so the hash choice cannot change a result.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default)]
pub struct Fnv(u64);

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        let mut h = if self.0 == 0 { 0xcbf2_9ce4_8422_2325 } else { self.0 };
        for b in bytes {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        self.0 = h;
    }
}

pub type FnvMap<K, V> = HashMap<K, V, BuildHasherDefault<Fnv>>;
