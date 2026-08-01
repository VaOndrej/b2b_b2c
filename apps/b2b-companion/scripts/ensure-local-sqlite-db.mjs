import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const dbPath = path.resolve(
  projectRoot,
  process.env.PRISMA_LOCAL_SQLITE_DB_PATH ?? path.join("prisma", "dev.sqlite"),
);
const prismaEnvPath = path.resolve(projectRoot, "prisma", ".env");

function toSqliteDatabaseUrl(absolutePath) {
  return `file:${absolutePath.split(path.sep).join(path.posix.sep)}`;
}

async function ensurePrismaDatabaseUrlFallback() {
  if (String(process.env.DATABASE_URL ?? "").trim()) {
    return;
  }

  let content = "";
  try {
    content = await readFile(prismaEnvPath, "utf8");
  } catch (error) {
    if (!(error && error.code === "ENOENT")) {
      throw error;
    }
  }

  if (/(^|\n)\s*DATABASE_URL\s*=/.test(content)) {
    return;
  }

  const line = `DATABASE_URL="${toSqliteDatabaseUrl(dbPath)}"`;
  const nextContent = content.trim().length > 0 ? `${content.trim()}\n${line}\n` : `${line}\n`;
  await mkdir(path.dirname(prismaEnvPath), { recursive: true });
  await writeFile(prismaEnvPath, nextContent, "utf8");
  console.log(
    `Created ${path.relative(projectRoot, prismaEnvPath)} with DATABASE_URL fallback for local Prisma migrations.`,
  );
}

await ensurePrismaDatabaseUrlFallback();

await mkdir(path.dirname(dbPath), { recursive: true });

try {
  await access(dbPath);
} catch (error) {
  if (error && error.code === "ENOENT") {
    const handle = await open(dbPath, "a");
    await handle.close();
    console.log(`Created ${path.relative(projectRoot, dbPath)} for local Prisma migrations.`);
  } else {
    throw error;
  }
}
