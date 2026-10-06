// What a running sync is doing right now, per shop, in THIS process (item 7:
// the admin says "zapisuje se na N produktů" instead of waiting). A plain
// in-memory map: it is a progress hint for the page, never a fact the sync
// decides anything by (the facts are SyncRun rows).

export interface SyncProgress {
  /** reading = collection members being read; writing = product metafields being written. */
  phase: "reading" | "writing";
  /** Products read / written so far. */
  done: number;
  /** Products to write (writing), or null while reading. */
  total: number | null;
}

const progress = new Map<string, SyncProgress>();

export function setSyncProgress(shop: string, value: SyncProgress): void {
  progress.set(shop, { ...value });
  if (progress.size > 10_000) progress.delete(progress.keys().next().value as string);
}

export function clearSyncProgress(shop: string): void {
  progress.delete(shop);
}

/** The shop's progress, or null when nothing product-related is running. */
export function syncProgress(shop: string): SyncProgress | null {
  const value = progress.get(shop);
  return value ? { ...value } : null;
}
