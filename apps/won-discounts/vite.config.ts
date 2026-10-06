import { reactRouter } from "@react-router/dev/vite";
import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, type Plugin, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

// Dev only: `shopify app dev` proxies every request under `/extensions` to its
// own extension server, so a `?raw` import of a file in extensions/ (the admin
// preview of the storefront block, TiersPreview.tsx) 404s through the tunnel and
// the route never hydrates inside Shopify admin. Serve those imports as virtual
// modules (`/@id/…`) instead. The build inlines the text and is left alone.
const RAW_EXTENSION_PREFIX = "\0won-extension-raw:";
const RAW_EXTENSION_SUFFIX = ".raw-text";
const extensionsDir = path.resolve(__dirname, "extensions") + path.sep;
const rawExtensionImports: Plugin = {
  name: "won-raw-extension-imports",
  apply: "serve",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!source.endsWith("?raw")) return null;
    const resolved = await this.resolve(source.slice(0, -"?raw".length), importer, { skipSelf: true });
    if (!resolved || !resolved.id.startsWith(extensionsDir)) return null;
    // The suffix keeps Vite's JSON and CSS plugins off the virtual module.
    return RAW_EXTENSION_PREFIX + path.relative(extensionsDir, resolved.id) + RAW_EXTENSION_SUFFIX;
  },
  load(id) {
    if (!id.startsWith(RAW_EXTENSION_PREFIX)) return null;
    const file = path.join(extensionsDir, id.slice(RAW_EXTENSION_PREFIX.length, -RAW_EXTENSION_SUFFIX.length));
    this.addWatchFile(file);
    return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
  },
};

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // Monorepo: allow serving workspace packages (@won/*) and hoisted node_modules from the repo root.
      allow: ["app", "node_modules", "../../packages", "../../node_modules"],
    },
  },
  plugins: [rawExtensionImports, reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
