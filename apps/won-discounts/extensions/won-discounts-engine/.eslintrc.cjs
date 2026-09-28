// Inherits the repo ESLint config; skips `shopify app function build` outputs
// (dist/ bundle, generated/ GraphQL types), which are not source.
module.exports = {
  ignorePatterns: ["dist/", "generated/"],
};
