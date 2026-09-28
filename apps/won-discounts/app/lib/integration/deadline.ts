// REL-1: an admin page renders even when Shopify is slow. Work that may take
// long (a resync, native detection) is raced against a deadline; when the
// deadline wins, the work keeps running in the background (its result lands in
// the DB / the cache for the next load) and the page says it is still running.
// The work's rejection is always observed here, so a late failure never becomes
// an unhandled rejection.

export type DeadlineOutcome<T> = { done: true; value: T } | { done: true; error: unknown } | { done: false };

export async function withinDeadline<T>(work: Promise<T>, ms: number): Promise<DeadlineOutcome<T>> {
  const settled: Promise<DeadlineOutcome<T>> = work.then(
    (value) => ({ done: true, value }),
    (error: unknown) => ({ done: true, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<DeadlineOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), Math.max(0, ms));
  });
  try {
    return await Promise.race([settled, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
