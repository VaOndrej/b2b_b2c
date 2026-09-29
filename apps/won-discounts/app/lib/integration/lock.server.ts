// One config writer at a time per shop (in this process). Every read-modify-
// write of the shop's config from the admin — a rule save/delete, an onboarding
// step, a native move or undo — runs through withConfigLock, so two clicks (or
// a rule save racing a move) never lose each other's change. The native layer
// keeps its own per-shop queue and cross-instance claims inside moveNative /
// undoMove; this lock only orders the admin's writes around them. Two app
// instances are not coordinated here (MVP 1 runs one instance; saveConfig is
// last-write-wins across instances).

const queues = new Map<string, Promise<unknown>>();

export function withConfigLock<T>(shop: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(shop) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(shop, settled);
  void settled.then(() => {
    if (queues.get(shop) === settled) queues.delete(shop);
  });
  return next;
}

/**
 * Non-blocking variant for a background sweep that must never queue behind a
 * writer (unlike withConfigLock, which always chains onto whatever is
 * currently queued): `{ skipped: true }` when the shop's lock is held or
 * waited on right now, so the caller moves on to its next shop instead of
 * stalling behind this one. The check and the acquisition happen in the same
 * synchronous step — no `await` between them — so nothing else in this
 * single-threaded process can acquire the lock in between; it is atomic in
 * that sense, not a check-then-later-act race like `isConfigLocked` followed
 * by a separate `withConfigLock` call across an `await`.
 */
export function tryWithConfigLock<T>(shop: string, run: () => Promise<T>): { skipped: true } | { skipped: false; result: Promise<T> } {
  if (queues.has(shop)) return { skipped: true };
  return { skipped: false, result: withConfigLock(shop, run) };
}

/**
 * True while some config writer (a save, a move, a resync) holds or waits for
 * the shop's lock. Přehled's GET trigger uses it to stay non-blocking: it never
 * queues a resync behind (or next to) another writer.
 */
export function isConfigLocked(shop: string): boolean {
  return queues.has(shop);
}

/** Resolves once nobody holds or waits for the shop's lock (tests; never awaited inside a lock). */
export async function configLockIdle(shop: string): Promise<void> {
  for (let queued = queues.get(shop); queued; queued = queues.get(shop)) {
    await queued;
    if (queues.get(shop) === queued) await Promise.resolve();
  }
}
