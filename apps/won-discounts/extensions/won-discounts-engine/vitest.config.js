export default {
  test: {
    forceRerunTriggers: [
      '**/tests/fixtures/**',
      '**/src/**',
    ],
    // default.test.js and parity.test.js each build the function first. A build
    // rewrites the output (build.mjs's wasm-opt) before the CLI re-applies its
    // trampoline, so a Wasm run during another file's build can hit the
    // untrampolined module ("unknown import shopify_function_v2::…").
    // One test file at a time.
    fileParallelism: false,
  },
};
