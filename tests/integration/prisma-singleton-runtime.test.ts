import test from "node:test";
import assert from "node:assert/strict";

test("db.server reuses one Prisma client across module reloads", async () => {
  const moduleUrl = new URL("../../app/db.server.ts", import.meta.url);
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPrismaGlobal = globalThis.prismaGlobal;

  try {
    process.env.NODE_ENV = "production";
    globalThis.prismaGlobal = undefined;

    const firstModule = await import(`${moduleUrl.href}?reload=1`);
    const secondModule = await import(`${moduleUrl.href}?reload=2`);

    assert.equal(firstModule.default, secondModule.default);
    assert.equal(globalThis.prismaGlobal, firstModule.default);
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.prismaGlobal = originalPrismaGlobal;
  }
});
