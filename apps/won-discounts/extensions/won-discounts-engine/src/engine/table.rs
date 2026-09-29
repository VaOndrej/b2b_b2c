// The run's lookup tables: open addressing with linear probing over a
// power-of-two array, at most half full (MVP 2 drift audit P1). A lookup in
// std's HashMap costs ~250–300 Wasm instructions here (hasher state, SWAR group
// probing, `Borrow` equality through `memcmp`, a byte loop in Wasm) and a
// 200-line Pro cart makes thousands of them (rule refs, collection settings,
// output grouping). Keys hash to one u64 cheaply (`TableKey`: a rule id by its
// length and first and last 8 bytes, a collection by its numeric id) and are
// compared a word at a time. Every table is only ever looked up and filled,
// never iterated in hash order, so the hash cannot change a result.

use super::margin::MarginRef;

/// A key's hash (any 64 bits: the table mixes them) and its equality.
pub trait TableKey: Eq {
    fn hash64(&self) -> u64;
}

/// 8 bytes of `b` from `i` as a little-endian word (one unaligned load in Wasm).
#[inline]
fn word(b: &[u8], i: usize) -> u64 {
    u64::from_le_bytes(b[i..i + 8].try_into().unwrap_or([0; 8]))
}

/// A text's hash: its length, first and last 8 bytes (a shorter text packed whole).
#[inline]
pub fn text_hash(b: &[u8]) -> u64 {
    let n = b.len();
    if n >= 8 {
        return word(b, 0) ^ word(b, n - 8).rotate_left(29) ^ ((n as u64) << 56);
    }
    let mut last = [0u8; 8];
    last[..n].copy_from_slice(b);
    u64::from_le_bytes(last) ^ ((n as u64) << 56)
}

/// `a == b` for byte strings, a word at a time (the last word may overlap the one
/// before): `str` equality goes through `memcmp`, which compiler-builtins
/// implements as a byte loop in Wasm (~8 instructions a byte).
#[inline]
pub fn bytes_eq(a: &[u8], b: &[u8]) -> bool {
    let n = a.len();
    if n != b.len() {
        return false;
    }
    if n < 8 {
        return a == b;
    }
    let mut i = 0;
    while i + 8 < n {
        if word(a, i) != word(b, i) {
            return false;
        }
        i += 8;
    }
    word(a, n - 8) == word(b, n - 8)
}

/// A text key compared a word at a time (`bytes_eq`).
#[derive(Debug, Clone, Copy)]
pub struct Text<'a>(pub &'a str);

impl PartialEq for Text<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        bytes_eq(self.0.as_bytes(), other.0.as_bytes())
    }
}

impl Eq for Text<'_> {}

impl TableKey for Text<'_> {
    #[inline]
    fn hash64(&self) -> u64 {
        text_hash(self.0.as_bytes())
    }
}

impl TableKey for u64 {
    #[inline]
    fn hash64(&self) -> u64 {
        *self
    }
}

impl TableKey for (usize, usize) {
    #[inline]
    fn hash64(&self) -> u64 {
        (self.0 as u64).rotate_left(32) ^ self.1 as u64
    }
}

impl TableKey for ((u8, u64), u32) {
    #[inline]
    fn hash64(&self) -> u64 {
        let ((kind, value), message) = *self;
        value ^ (u64::from(kind) << 61) ^ u64::from(message).rotate_left(40)
    }
}

impl TableKey for &[MarginRef] {
    fn hash64(&self) -> u64 {
        let mut h = self.len() as u64;
        for r in self.iter() {
            let v = match r {
                MarginRef::Id(n) => *n,
                MarginRef::Text(t) => text_hash(t.as_bytes()) ^ (1 << 63),
            };
            h = (h.rotate_left(23) ^ v).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        }
        h
    }
}

impl TableKey for (usize, String) {
    #[inline]
    fn hash64(&self) -> u64 {
        text_hash(self.1.as_bytes()) ^ (self.0 as u64).rotate_left(17)
    }
}

/// An open-addressing hash table (see the header).
#[derive(Clone)]
pub struct Table<K, V> {
    slots: Vec<Option<(K, V)>>,
    /// log2 of the slot count.
    bits: u32,
    len: usize,
}

impl<K: TableKey, V> Default for Table<K, V> {
    fn default() -> Self {
        Self::with_capacity(0)
    }
}

impl<K: TableKey, V> Table<K, V> {
    /// Room for `n` entries without growing.
    pub fn with_capacity(n: usize) -> Self {
        let bits = (n.max(4) * 2).next_power_of_two().trailing_zeros();
        Self { slots: (0..1usize << bits).map(|_| None).collect(), bits, len: 0 }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    fn home(&self, key: &K) -> usize {
        // Fibonacci hashing: the product's high bits depend on every bit of the hash.
        (key.hash64().wrapping_mul(0x9E37_79B9_7F4A_7C15) >> (64 - self.bits)) as usize
    }

    #[inline]
    fn mask(&self) -> usize {
        (1 << self.bits) - 1
    }

    /// The slot holding `key`, or the empty slot where it would go.
    #[inline]
    fn find(&self, key: &K) -> (usize, bool) {
        let mask = self.mask();
        let mut i = self.home(key);
        loop {
            match &self.slots[i] {
                None => return (i, false),
                Some((k, _)) if k == key => return (i, true),
                Some(_) => i = (i + 1) & mask,
            }
        }
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<&V> {
        match self.find(key) {
            (i, true) => self.slots[i].as_ref().map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        match self.find(key) {
            (i, true) => self.slots[i].as_mut().map(|(_, v)| v),
            _ => None,
        }
    }

    fn grow(&mut self) {
        let old = std::mem::take(&mut self.slots);
        self.bits += 1;
        self.slots = (0..1usize << self.bits).map(|_| None).collect();
        let mask = self.mask();
        for (k, v) in old.into_iter().flatten() {
            let mut i = self.home(&k);
            while self.slots[i].is_some() {
                i = (i + 1) & mask;
            }
            self.slots[i] = Some((k, v));
        }
    }

    /// `map.insert(key, value)`: a key already there keeps its slot and gets the new value.
    pub fn insert(&mut self, key: K, value: V) {
        if (self.len + 1) * 2 > self.slots.len() {
            self.grow();
        }
        match self.find(&key) {
            (i, true) => self.slots[i] = Some((key, value)),
            (i, false) => {
                self.slots[i] = Some((key, value));
                self.len += 1;
            }
        }
    }

    /// The value of `key`, inserted by `make` when absent (`entry().or_insert_with`).
    pub fn get_or_insert_with(&mut self, key: K, make: impl FnOnce() -> V) -> &mut V {
        if (self.len + 1) * 2 > self.slots.len() {
            self.grow();
        }
        let (i, found) = self.find(&key);
        if !found {
            self.slots[i] = Some((key, make()));
            self.len += 1;
        }
        match &mut self.slots[i] {
            Some((_, v)) => v,
            None => unreachable!("the slot was just filled"),
        }
    }

    /// `map.remove(key)`: backward-shift deletion keeps every probe run unbroken.
    pub fn remove(&mut self, key: &K) {
        let (mut hole, found) = self.find(key);
        if !found {
            return;
        }
        self.slots[hole] = None;
        self.len -= 1;
        let mask = self.mask();
        let mut i = (hole + 1) & mask;
        while let Some((k, _)) = &self.slots[i] {
            let home = self.home(k);
            // Move the entry back into the hole when its home is not in (hole, i].
            let in_range = if hole <= i { home > hole && home <= i } else { home > hole || home <= i };
            if !in_range {
                self.slots[hole] = self.slots[i].take();
                hole = i;
            }
            i = (i + 1) & mask;
        }
    }

    /// Every entry, in slot order (callers sort when an order matters).
    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.slots.iter().flatten().map(|(k, v)| (k, v))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_table_answers_like_a_hash_map_through_inserts_updates_and_removes() {
        // Many colliding homes (a tiny table grown step by step), removals in the middle of runs.
        let mut table: Table<u64, u64> = Table::with_capacity(0);
        let mut map: HashMap<u64, u64> = HashMap::new();
        let mut x: u64 = 0x2545_F491_4F6C_DD1D;
        for step in 0..20_000u64 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let key = x % 97;
            match x % 5 {
                0 | 1 => {
                    table.insert(key, step);
                    map.insert(key, step);
                }
                2 => {
                    table.remove(&key);
                    map.remove(&key);
                }
                3 => {
                    *table.get_or_insert_with(key, || step) += 1;
                    *map.entry(key).or_insert(step) += 1;
                }
                _ => {}
            }
            assert_eq!(table.len(), map.len());
            for k in 0..97 {
                assert_eq!(table.get(&k), map.get(&k), "step {step} key {k}");
            }
        }
    }

    #[test]
    fn texts_are_equal_exactly_when_their_bytes_are() {
        let texts = ["", "a", "ab", "abcdefg", "abcdefgh", "abcdefgi", "abcdefghi", "bbcdefghi", "r_0123456789abcdef0123", "r_0123456789abcdef0124", "s_0123456789abcdef0123", "ř_0123456789abcdef0123"];
        for a in texts {
            for b in texts {
                assert_eq!(Text(a) == Text(b), a == b, "{a:?} {b:?}");
            }
        }
        for n in 0..40 {
            let x: String = (0..n).map(|i| char::from(b'a' + (i % 26) as u8)).collect();
            for k in 0..n {
                let mut y = x.clone().into_bytes();
                y[k] ^= 1;
                let y = String::from_utf8(y).unwrap();
                assert!(Text(&x) != Text(&y), "{x} {y}");
            }
            assert!(Text(&x) == Text(&x.clone()));
        }
    }

    #[test]
    fn text_keys_find_their_own_value_only() {
        let ids: Vec<String> = (0..300).map(|i| format!("r_{:020x}", (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))).collect();
        let mut more: Vec<String> = ["", "a", "ab", "abcdefgh", "abcdefghi", "rule-000-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"].iter().map(|s| s.to_string()).collect();
        // Same length, first and last 8 bytes: they share a hash and must still differ.
        more.push(format!("r_000000{}00000000", "a".repeat(10)));
        more.push(format!("r_000000{}00000000", "b".repeat(10)));
        let all: Vec<&str> = ids.iter().chain(more.iter()).map(String::as_str).collect();
        let mut table: Table<Text, usize> = Table::with_capacity(all.len());
        for (i, id) in all.iter().enumerate() {
            table.insert(Text(id), i);
        }
        for (i, id) in all.iter().enumerate() {
            assert_eq!(table.get(&Text(id)), Some(&i), "{id}");
        }
        assert_eq!(table.get(&Text("r_000000cccccccccc00000000")), None);
        assert_eq!(table.get(&Text("abcdefghj")), None);
    }
}
