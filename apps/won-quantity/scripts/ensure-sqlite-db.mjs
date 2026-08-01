import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readDatabaseUrlFromDotenv() {
  const dotenvPath = path.join(appRoot, ".env");
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

const databaseUrl =
  String(process.env.DATABASE_URL ?? "").trim() || readDatabaseUrlFromDotenv();

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
