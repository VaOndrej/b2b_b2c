// The native layer's SaveAndSync over the canonical app/lib/sync saveAndSync,
// at the path scripts/native/move-live.mjs loads by default
// (`createSaveAndSync({ client, db })`). The admin uses the same adapter
// (app/lib/integration/native.server.ts).

export { createSaveAndSync } from "./integration/native.server";
