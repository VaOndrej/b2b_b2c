import { createHandleRequest, streamTimeout } from "@won/app-kit/entry.server";
import { addDocumentResponseHeaders } from "./shopify.server";
import db from "./db.server";
import { startStaleClaimJob } from "./lib/jobs/stale-claims.server";

export { streamTimeout };

// Native move audit follow-up: without this, a `moving` / `undoing` claim a
// dead process left (a double discount, native + Won rule both live) is only
// settled when a merchant opens Přehled — unbounded with nobody looking. This
// starts the periodic sweep once per process on server boot (Fly runs this
// app as a single machine today; see app/lib/jobs/stale-claims.server.ts for
// the single-instance note and MVP 5's scheduler taking this over later).
startStaleClaimJob({ db });

export default createHandleRequest(addDocumentResponseHeaders);
