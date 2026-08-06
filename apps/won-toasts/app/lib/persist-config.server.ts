// Graceful save guard. A settings save must NEVER white-screen the admin: if the
// persistence layer throws (e.g. a stale Prisma client after a schema change, a
// locked SQLite file, a transient DB error), React Router's error boundary would
// otherwise render the raw stack as an "Application Error" page — exactly what a
// merchant saw when turning every toast off. Instead we catch, log the real error
// server-side, and hand the page a friendly result it can show inline.
//
// Actions return this shape; `useSaveResult` turns it into a success/error toast.

export type SaveResult = { saved: boolean; error?: string };

const FRIENDLY_ERROR =
  "We couldn't save your changes. Please reload the page and try again — if it keeps happening, contact support.";

/**
 * Run a persistence function and normalise the outcome. On success returns
 * `{ saved: true }`; on any throw logs the cause and returns `{ saved: false }`
 * with a human message (never the raw error) so nothing leaks to the merchant.
 */
export async function persistConfig(
  fn: () => Promise<unknown>,
): Promise<SaveResult> {
  try {
    await fn();
    return { saved: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[won-toasts] config save failed:", err);
    return { saved: false, error: FRIENDLY_ERROR };
  }
}
