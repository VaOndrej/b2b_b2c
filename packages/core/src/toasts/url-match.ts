// MVP10 — URL matching for exclusions. The storefront tests location.pathname
// against merchant patterns. Patterns support a trailing/segment `*` glob;
// query strings and hashes are ignored. Pure + framework-free.

/** Drop query/hash, guarantee a leading slash, never empty. */
export function normalizePath(input: string): string {
  let p = String(input ?? "");
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p) return "/";
  return p.charAt(0) === "/" ? p : "/" + p;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a pathname against one pattern. `*` is a wildcard (any run of chars).
 * Both sides are normalized (query/hash stripped). Exact otherwise.
 */
export function matchUrlPattern(pathname: string, pattern: string): boolean {
  const path = normalizePath(pathname);
  const pat = normalizePath(pattern);
  if (pat.indexOf("*") < 0) return path === pat;
  // Build an anchored regex, translating each '*' to '.*'.
  const re = new RegExp(
    "^" +
      pat
        .split("*")
        .map(escapeRegExp)
        .join(".*") +
      "$",
  );
  return re.test(path);
}

/** True when ANY non-blank pattern matches. Blank patterns are ignored. */
export function pathExcluded(
  pathname: string,
  patterns: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(patterns)) return false;
  for (const raw of patterns) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (matchUrlPattern(pathname, raw.trim())) return true;
  }
  return false;
}
