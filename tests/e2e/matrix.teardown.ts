import {
  disconnectE2EPrisma,
  restoreSnapshotFromFile,
  resyncStorefrontProjectionForE2E,
} from "./support/seed.ts";

/**
 * Playwright globalTeardown for the parallel matrix suite. Restores the config
 * snapshot captured to file by globalSetup (separate process) and re-projects
 * it so the live shop returns to its original storefront state. No-op when no
 * snapshot file exists (nothing was seeded).
 */
export default async function globalTeardown() {
  try {
    const restored = await restoreSnapshotFromFile();
    if (restored) {
      await resyncStorefrontProjectionForE2E();
    }
  } finally {
    await disconnectE2EPrisma();
  }
}
