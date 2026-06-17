import {
  captureSnapshotToFile,
  disconnectE2EPrisma,
  resyncStorefrontProjectionForE2E,
  seedE2EMatrix,
} from "./support/seed.ts";
import {
  buildE2EMatrix,
  readManifestMatrix,
  writeMatrixFile,
} from "./support/matrix.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Playwright globalSetup for the parallel matrix suite. Runs ONCE before test
 * discovery so the `.matrix.json` file exists when the data-driven specs are
 * collected. Captures the original config, then seeds every archetype rule
 * across distinct catalog products/collections and syncs the projection.
 *
 * Because all rules are seeded here (not per-test), the matrix specs never
 * mutate shared state and are safe to run fully in parallel.
 */
export default async function globalSetup() {
  const matrix = await buildE2EMatrix();
  writeMatrixFile(matrix);

  try {
    // Manifest mode: the comprehensive seeder (scripts/seed-e2e-catalog.ts) owns
    // the data ADDITIVELY. Do NOT reset/snapshot — just ensure the storefront
    // projection is current and leave the seeded state in place.
    if (readManifestMatrix()) {
      await resyncStorefrontProjectionForE2E();
    } else {
      // Legacy mode (no manifest): capture the pre-seed config so the
      // separate-process teardown can restore it, then seed archetypes from the
      // synced catalog.
      await captureSnapshotToFile();

      if (matrix.products.length === 0 && matrix.collections.length === 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[matrix.globalSetup] Empty catalog — no products/collections to seed. Notes:\n" +
            matrix.notes.map((note) => `  - ${note}`).join("\n"),
        );
      } else {
        const result = await seedE2EMatrix(matrix);
        if (!result.seeded && result.reason) {
          // eslint-disable-next-line no-console
          console.warn(`[matrix.globalSetup] Partial seed: ${result.reason}`);
        }

        if (matrix.notes.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            "[matrix.globalSetup] Coverage gaps:\n" +
              matrix.notes.map((note) => `  - ${note}`).join("\n"),
          );
        }
      }
    }
  } finally {
    await disconnectE2EPrisma();
  }

  // Absorb the dev-tunnel cold-start once so the parallel matrix runs warm.
  await warmStorefrontTunnel(matrix.products[0]?.handle);
}
