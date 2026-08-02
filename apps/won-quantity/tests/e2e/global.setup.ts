import { seedQuantityE2EState } from "./support/seed.ts";

export default async function globalSetup(): Promise<void> {
  await seedQuantityE2EState();
}
