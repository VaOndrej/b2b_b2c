import { PrismaClient } from "./generated/prisma";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

if (!globalThis.prismaGlobal) {
  globalThis.prismaGlobal = new PrismaClient();
}

const prisma = globalThis.prismaGlobal;

export default prisma;
