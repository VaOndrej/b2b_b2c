// MVP13c (live A/B serving) — apply a variant's partial config over the resolved
// base config. Every experiment stores a `variant` as a partial config; the
// storefront (and, for previews, the server) deep-merges it over the shopper's
// resolved config so the variant arm renders the changed behaviour while the
// control arm renders the base — same shopper always sees the same arm.
//
// Pure and side-effect free: the base is never mutated (the control cohort must
// be unaffected). Objects deep-merge; arrays and scalars are replaced wholesale
// (a partial `milestones`/`notifications` list means "use this list", not "merge
// element-wise").

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function applyConfigOverlay<T>(base: T, overlay: unknown): T {
  if (!isPlainObject(overlay)) return base;
  if (!isPlainObject(base)) return overlay as T;

  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const ov = overlay[key];
    const bv = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(ov) && isPlainObject(bv) ? applyConfigOverlay(bv, ov) : ov;
  }
  return out as T;
}
