// Import this FIRST in a test that (dynamically) loads a module with a Vite
// `?raw` import — the admin preview of the quantity-tier block (MVP 3) — so
// node can load it like Vite does (./raw-hooks.mjs). Modules that need it must
// be imported with `await import()` after this one: static imports are all
// loaded before any module body runs.

import { register } from "node:module";

register(new URL("./raw-hooks.mjs", import.meta.url));
