// Inherits the repo ESLint config; skips build outputs (target/: cargo, dist/ and
// generated/: leftovers of the JS version), which are not source.
module.exports = {
  ignorePatterns: ["dist/", "generated/", "target/"],
};
