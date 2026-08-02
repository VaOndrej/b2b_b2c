import { restoreQuantityE2EState } from "./support/seed.ts";

export default async function globalTeardown(): Promise<void> {
  await restoreQuantityE2EState();
}
