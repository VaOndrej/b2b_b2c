import { teardownE2ECatalog } from "./support/catalog-e2e.ts";
import { disconnectE2EPrisma } from "./support/seed.ts";

/**
 * Playwright globalTeardown for the parallel matrix suite. Deletes the dedicated
 * e2e price catalog (cascade removes its rules) and re-projects the storefront so
 * the live shop returns to its original state. Zero blast radius: only the e2e
 * catalog is touched; the user's default/b2b config is untouched throughout.
 */
export default async function globalTeardown() {
  try {
    await teardownE2ECatalog();
  } finally {
    await disconnectE2EPrisma();
  }
}
