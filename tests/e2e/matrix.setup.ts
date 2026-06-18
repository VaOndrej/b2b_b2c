import {
  seedE2ECatalogRules,
  setupE2ECatalog,
} from "./support/catalog-e2e.ts";
import {
  disconnectE2EPrisma,
  resyncStorefrontProjectionForE2E,
} from "./support/seed.ts";
import { buildE2EMatrix, writeMatrixFile } from "./support/matrix.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Playwright globalSetup for the parallel matrix suite. Runs ONCE before test
 * discovery so the `.matrix.json` file exists when the data-driven specs are
 * collected.
 *
 * Catalog-native (MVP_5_4): creates the dedicated, disposable e2e price catalog,
 * derives the deterministic matrix from the synced catalog products, and seeds
 * each archetype's rule onto the e2e catalog (one rule per product). All e2e
 * rules live on that one catalog — the user's default/b2b config is never touched
 * (globalTeardown deletes it). Because every rule is seeded here, the matrix
 * specs are read-only and safe to run fully in parallel.
 */
export default async function globalSetup() {
  let firstHandle: string | undefined;
  try {
    const { catalogId, audienceTag } = await setupE2ECatalog();
    const matrix = await buildE2EMatrix(audienceTag);
    writeMatrixFile(matrix);
    firstHandle = matrix.products[0]?.handle;

    if (matrix.products.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[matrix.globalSetup] Empty catalog — no products to seed. Notes:\n" +
          matrix.notes.map((note) => `  - ${note}`).join("\n"),
      );
    } else {
      await seedE2ECatalogRules(catalogId, matrix);
      if (matrix.notes.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix.globalSetup] Coverage gaps:\n" +
            matrix.notes.map((note) => `  - ${note}`).join("\n"),
        );
      }
    }

    // Keep the live shop metafield consistent with the post-seed DB state. The
    // e2e catalog has no segment, so this does not change the b2b/b2c snapshots.
    await resyncStorefrontProjectionForE2E();
  } finally {
    await disconnectE2EPrisma();
  }

  // Absorb the dev-tunnel cold-start once so the parallel matrix runs warm.
  await warmStorefrontTunnel(firstHandle);
}
