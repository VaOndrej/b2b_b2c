# Page snapshot

```yaml
- alert [ref=e4]:
  - generic [ref=e6]:
    - generic [ref=e9]:
      - img [ref=e12]
      - heading "Failed to render storefront with status 502 (Bad Gateway)." [level=2] [ref=e16]
    - generic [ref=e19]:
      - text: Response body object should not be disturbed or locked
      - list [ref=e20]:
        - listitem [ref=e21]: "TypeError: at extractBody (node:internal/deps/undici/undici:6797:17) at new Response (node:internal/deps/undici/undici:12075:41) at patchProxiedResponseHeaders (file:///Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/dist/index.js:345726:18) at patchRenderingResponse (file:///Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/dist/index.js:345707:18) at file:///Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/dist/index.js:345807:53 at process.processTicksAndRejections (node:internal/process/task_queues:104:5) at async Object.handler (file:///Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/dist/index.js:344159:17) at async Server.<anonymous> (file:///Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/node_modules/@shopify/cli/dist/index.js:344253:7)"
```