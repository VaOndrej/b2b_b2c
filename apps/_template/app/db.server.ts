import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

if (!globalThis.prismaGlobal) {
  globalThis.prismaGlobal = new PrismaClient();
}

const prisma = globalThis.prismaGlobal;

export default prisma;
