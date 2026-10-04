import { createHandleRequest, streamTimeout } from "@won/app-kit/entry.server";
import { addDocumentResponseHeaders } from "./shopify.server";
import db from "./db.server";
import { offlineClient } from "./lib/integration/costs.server";
import { ensureCostReconcileJob } from "./lib/jobs/cost-reconcile.server";
import { startScheduler } from "./lib/jobs/scheduler.server";
import { startStaleClaimJob } from "./lib/jobs/stale-claims.server";
import { setPlanDatabase } from "./lib/plan.server";

export { streamTimeout };

// Billing (MVP 7): the plan resolver reads the shop's verified subscription from the app's database (BILL-1).
setPlanDatabase(db);

// Native move audit follow-up: without this, a `moving` / `undoing` claim a
// dead process left (a double discount, native + Won rule both live) is only
// settled when a merchant opens Přehled — unbounded with nobody looking. This
// starts the periodic sweep once per process on server boot (Fly runs this
// app as a single machine today; see app/lib/jobs/stale-claims.server.ts for
// the single-instance note and MVP 5's scheduler taking this over later).
startStaleClaimJob({ db });

// Margin protection (MVP 2): the daily reconcile of the cost mirror — a full
// pass for every shop whose last one is older than 24 h, a clear for a shop
// that switched protection off — must run with nobody looking too (webhooks
// can be lost). Started once per process here on boot (idempotent: the
// margin screen and Přehled also ensure it); app/lib/jobs/cost-reconcile.server.ts.
ensureCostReconcileJob(db, { clientFor: offlineClient });

// Výprodej (MVP 5, contract O8): the scheduler — sales at their end date, failed ends retried, the history
// retention — with its state in the DB (a task that came due while the process was down runs after the boot).
startScheduler(db, { clientFor: offlineClient });

export default createHandleRequest(addDocumentResponseHeaders);
