// What a cleanup WITHOUT the seed's backup file may do with the stored margin
// settings (scripts/e2e/seed-mvp1.mjs --cleanup, fix round 1 of Task 5b).
// With the backup the seed simply restores the config it replaced; without it,
// only settings that are recognisably the E2E fixture's are switched off —
// anything else could be the merchant's and is never touched.
//
//   classifyStoredMargin(margin, { isFixtureCollection })
//     → { kind: "default" }            protection off and nothing set beyond the
//                                       defaults: nothing to do;
//     → { kind: "fixture", profile }   exactly the margin seed ("margin") or the
//                                       Pro seed ("margin-pro": the one
//                                       collection override of won-e2e-margin),
//                                       on or off: reset to the defaults;
//     → { kind: "foreign", reason }    anything else: leave it as it is.
//
// `isFixtureCollection(collectionId)` says whether an override's collection is
// the E2E test collection: the seed answers it from the store (the GID of
// `won-e2e-margin` when it exists; when it no longer exists, a GID that no
// longer resolves — the override is then dead anyway). Pure: unit-tested in
// scripts/e2e/margin-cleanup.test.mjs.

import {
  MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT,
  MARGIN_MAX_DISCOUNT_PERCENT,
  MARGIN_MIN_MARGIN_PERCENT,
} from "./margin-fixture.mjs";

/** The app's default margin module (config defaults): off, maximum discount 50 %, nothing else. */
export const DEFAULT_MAX_DISCOUNT_PERCENT = 50;

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const keysOf = (o) => Object.keys(o).filter((k) => o[k] !== undefined).sort();
const sameKeys = (o, keys) => JSON.stringify(keysOf(o)) === JSON.stringify([...keys].sort());

function isFixtureGlobal(global) {
  return (
    isRecord(global) &&
    sameKeys(global, ["minMarginPercent", "maxDiscountPercent"]) &&
    global.minMarginPercent === MARGIN_MIN_MARGIN_PERCENT &&
    global.maxDiscountPercent === MARGIN_MAX_DISCOUNT_PERCENT
  );
}

function isDefault(margin) {
  return (
    margin.enabled !== true &&
    isRecord(margin.global) &&
    sameKeys(margin.global, ["maxDiscountPercent"]) &&
    margin.global.maxDiscountPercent === DEFAULT_MAX_DISCOUNT_PERCENT &&
    Array.isArray(margin.perCollection) &&
    margin.perCollection.length === 0
  );
}

/**
 * @param {unknown} margin  the stored config's modules.margin
 * @param {{ isFixtureCollection: (collectionId: string) => boolean }} opts
 * @returns {{ kind: "default" } | { kind: "fixture", profile: "margin" | "margin-pro", collectionId?: string } | { kind: "foreign", reason: string }}
 */
export function classifyStoredMargin(margin, { isFixtureCollection }) {
  if (margin === undefined || margin === null) return { kind: "default" };
  if (!isRecord(margin)) return { kind: "foreign", reason: "not an object" };
  if (isDefault(margin)) return { kind: "default" };
  if (!sameKeys(margin, ["enabled", "global", "perCollection"])) return { kind: "foreign", reason: `unexpected fields ${JSON.stringify(keysOf(margin))}` };
  if (typeof margin.enabled !== "boolean") return { kind: "foreign", reason: "enabled is not a boolean" };
  if (!isFixtureGlobal(margin.global)) {
    return { kind: "foreign", reason: `global settings ${JSON.stringify(margin.global)} are not the fixture's (min ${MARGIN_MIN_MARGIN_PERCENT} %, max ${MARGIN_MAX_DISCOUNT_PERCENT} %)` };
  }
  const overrides = Array.isArray(margin.perCollection) ? margin.perCollection : null;
  if (overrides === null) return { kind: "foreign", reason: "perCollection is not a list" };
  if (overrides.length === 0) return { kind: "fixture", profile: "margin" };
  if (overrides.length > 1) return { kind: "foreign", reason: `${overrides.length} collection overrides (the Pro fixture has exactly 1)` };
  const o = overrides[0];
  if (!isRecord(o) || !sameKeys(o, ["collectionId", "maxDiscountPercent"]) || o.maxDiscountPercent !== MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT) {
    return { kind: "foreign", reason: `collection override ${JSON.stringify(o)} is not the fixture's (maximum discount ${MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT} %, no minimum)` };
  }
  if (typeof o.collectionId !== "string" || !isFixtureCollection(o.collectionId)) {
    return { kind: "foreign", reason: `collection ${String(o.collectionId)} is not the E2E test collection` };
  }
  return { kind: "fixture", profile: "margin-pro", collectionId: o.collectionId };
}
