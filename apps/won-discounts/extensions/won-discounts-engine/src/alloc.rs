// The Wasm build's global allocator: a bump allocator (MVP 2 instruction budget).
//
// A function run is one short-lived call whose linear memory Shopify throws away
// afterwards, so freeing is pure cost: with Rust's default allocator (dlmalloc)
// every String read from the input, every Vec and their drops went through
// malloc/free bookkeeping — about a million instructions of a 200-line cart
// (Shopify's limit is 11 M; we keep ≥ 30 % headroom, README "Instruction
// budget"). Here an allocation moves a pointer; freeing or growing the most
// recent block is done in place, anything else is left where it is.
//
// Memory: what a run allocates stays allocated. The input is at most 128 kB and
// a run builds a few structures per line, so a 260-line cart stays around 2 MB
// of linear memory (the parity test checks every run against a bound far below
// Shopify's 10 000 kB limit). Memory is taken from the Wasm module in 1 MiB
// steps (`memory.grow`), contiguous with the previous step when nothing else
// grew the memory in between. If `memory.grow` fails the allocation returns
// null, which Rust turns into an abort: the run fails and the node gives no
// discount, like any other resource-limit failure (checkout is not blocked).
//
// Native builds (cargo test) keep the system allocator.

use std::alloc::{GlobalAlloc, Layout};
use std::cell::Cell;

const PAGE: usize = 65_536;
/// Pages per `memory.grow` (1 MiB).
const STEP_PAGES: usize = 16;

pub struct BumpAllocator {
    /// The next free byte.
    next: Cell<usize>,
    /// The end of the memory this allocator owns (0 before the first allocation).
    end: Cell<usize>,
}

// Wasm functions run single-threaded.
unsafe impl Sync for BumpAllocator {}

impl BumpAllocator {
    pub const fn new() -> Self {
        Self { next: Cell::new(0), end: Cell::new(0) }
    }

    #[inline]
    fn take(&self, size: usize, align: usize) -> *mut u8 {
        let start = (self.next.get() + align - 1) & !(align - 1);
        match start.checked_add(size) {
            Some(end) if self.end.get() != 0 && end <= self.end.get() => {
                self.next.set(end);
                start as *mut u8
            }
            _ => self.grow(size, align),
        }
    }

    #[cold]
    fn grow(&self, size: usize, align: usize) -> *mut u8 {
        let Some(bytes) = size.checked_add(align) else { return std::ptr::null_mut() };
        let pages = bytes.div_ceil(PAGE).max(STEP_PAGES);
        let previous = core::arch::wasm32::memory_grow(0, pages);
        if previous == usize::MAX {
            return std::ptr::null_mut();
        }
        let base = previous * PAGE;
        if self.end.get() == 0 || base != self.end.get() {
            // Not contiguous with what we had (or the first step): start over at the new pages.
            self.next.set(base);
        }
        self.end.set(base + pages * PAGE);
        self.take(size, align)
    }
}

unsafe impl GlobalAlloc for BumpAllocator {
    #[inline]
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.take(layout.size(), layout.align())
    }

    /// Only the most recent block is given back (a temporary freed right away).
    #[inline]
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if ptr as usize + layout.size() == self.next.get() {
            self.next.set(ptr as usize);
        }
    }

    /// The most recent block grows or shrinks in place (a Vec being filled);
    /// any other block is copied to a new one.
    #[inline]
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let old_size = layout.size();
        let start = ptr as usize;
        if start + old_size == self.next.get() && start.checked_add(new_size).is_some_and(|end| end <= self.end.get()) {
            self.next.set(start + new_size);
            return ptr;
        }
        let new = self.take(new_size, layout.align());
        if !new.is_null() {
            // SAFETY: both blocks are valid for min(old, new) bytes and never overlap
            // (the new one starts at or after the end of every live block).
            unsafe { std::ptr::copy_nonoverlapping(ptr, new, old_size.min(new_size)) };
        }
        new
    }
}

#[global_allocator]
static ALLOCATOR: BumpAllocator = BumpAllocator::new();
