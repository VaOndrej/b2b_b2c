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
