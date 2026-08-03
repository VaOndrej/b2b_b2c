import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// A brand-new checkout of an app cloned from this template has no .env (it is
// gitignored). Fall back to a local SQLite database so `prisma migrate deploy`
// and `shopify app dev` work with zero manual setup. Real deployments still
// provide DATABASE_URL via the environment.
const DEFAULT_DATABASE_URL = "file:./dev.sqlite";

function readDatabaseUrlFromDotenv(dotenvPath) {
  if (!existsSync(dotenvPath)) {
    return "";
  }
  const line = readFileSync(dotenvPath, "utf8")
    .split(/\r?\n/u)
    .find((candidate) => candidate.trim().startsWith("DATABASE_URL="));
  if (!line) {
    return "";
  }
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
}

const appEnvPath = path.join(appRoot, ".env");
const prismaEnvPath = path.join(appRoot, "prisma", ".env");

let databaseUrl =
  String(process.env.DATABASE_URL ?? "").trim() ||
  readDatabaseUrlFromDotenv(appEnvPath) ||
  readDatabaseUrlFromDotenv(prismaEnvPath);

// Nothing configured anywhere → write a Prisma-loaded fallback (never clobbers
// an existing value). Prisma auto-loads prisma/.env next to schema.prisma, so
// the subsequent `prisma migrate deploy` process picks it up.
if (!databaseUrl) {
  mkdirSync(path.dirname(prismaEnvPath), { recursive: true });
  writeFileSync(prismaEnvPath, `DATABASE_URL="${DEFAULT_DATABASE_URL}"\n`, "utf8");
  databaseUrl = DEFAULT_DATABASE_URL;
  console.log(
    "Created prisma/.env with a local SQLite DATABASE_URL fallback for first-run setup.",
  );
}

if (!databaseUrl.startsWith("file:")) {
  process.exit(0);
}

const configuredPath = databaseUrl.slice("file:".length);
if (!configuredPath) {
  throw new Error(
    "DATABASE_URL uses file: but does not include a SQLite path.",
  );
}

// Prisma resolves relative SQLite URLs against the directory containing
// schema.prisma, not against the shell's current working directory.
const databasePath = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.resolve(appRoot, "prisma", configuredPath);

mkdirSync(path.dirname(databasePath), { recursive: true });
const descriptor = openSync(databasePath, "a");
closeSync(descriptor);
