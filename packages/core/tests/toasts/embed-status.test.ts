import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmbedDeepLink,
  extractEmbedExtensionUuid,
  isEmptyStore,
  parseEmbedStatus,
  resolveEmbedState,
} from "../../src/toasts/embed-status.ts";

const HANDLE = "won_toasts_embed";

/** A settings_data.json string carrying our embed block (optionally disabled). */
function themeSettings(uuid: string, disabled = false): string {
  return JSON.stringify({
    current: {
      blocks: {
        rid: {
          type: `shopify://apps/won-toasts/blocks/${HANDLE}/${uuid}`,
          disabled,
        },
      },
    },
  });
}

function settingsWith(block: Record<string, unknown> | null) {
  return {
    current: {
      blocks: block ? { some_random_id: block } : {},
    },
  };
}

test("parseEmbedStatus: block present and not disabled → enabled", () => {
  const data = settingsWith({
    type: `shopify://apps/won-toasts/blocks/${HANDLE}/b1f133d7`,
    disabled: false,
  });
  assert.equal(parseEmbedStatus(data, HANDLE), "enabled");
});

test("parseEmbedStatus: block present but disabled → disabled", () => {
  const data = settingsWith({
    type: `shopify://apps/won-toasts/blocks/${HANDLE}/b1f133d7`,
    disabled: true,
  });
  assert.equal(parseEmbedStatus(data, HANDLE), "disabled");
});

test("parseEmbedStatus: our block missing → unknown", () => {
  const data = settingsWith({
    type: "shopify://apps/other-app/blocks/something/uuid",
  });
  assert.equal(parseEmbedStatus(data, HANDLE), "unknown");
});

test("parseEmbedStatus: accepts a raw JSON string and malformed input", () => {
  const raw = JSON.stringify(
    settingsWith({
      type: `shopify://apps/won-toasts/blocks/${HANDLE}/uuid`,
    }),
  );
  assert.equal(parseEmbedStatus(raw, HANDLE), "enabled");
  assert.equal(parseEmbedStatus("not json", HANDLE), "unknown");
  assert.equal(parseEmbedStatus(null, HANDLE), "unknown");
});

test("parseEmbedStatus: strips the leading /* … */ banner of settings_data.json", () => {
  // Real Shopify settings_data.json starts with a generated-file comment.
  const raw =
    "/*\n * Shopify generated file — do not edit.\n */\n" +
    JSON.stringify(
      settingsWith({
        type: `shopify://apps/won-toasts/blocks/${HANDLE}/019fcc26-7067`,
        disabled: false,
      }),
    );
  assert.equal(parseEmbedStatus(raw, HANDLE), "enabled");
  assert.equal(extractEmbedExtensionUuid(raw, HANDLE), "019fcc26-7067");
});

test("buildEmbedDeepLink produces the theme-editor app-embed URL", () => {
  const url = buildEmbedDeepLink({
    shop: "demo.myshopify.com",
    extensionUuid: "b1f133d7-de4f-01e6-46e4-4013aeb84013",
    blockHandle: HANDLE,
  });
  assert.equal(
    url,
    "https://demo.myshopify.com/admin/themes/current/editor?context=apps&template=index&activateAppId=b1f133d7-de4f-01e6-46e4-4013aeb84013/won_toasts_embed",
  );
});

test("extractEmbedExtensionUuid pulls the UUID after the block handle", () => {
  const data = settingsWith({
    type: `shopify://apps/won-toasts/blocks/${HANDLE}/9f8e7d6c-1234`,
    disabled: false,
  });
  assert.equal(extractEmbedExtensionUuid(data, HANDLE), "9f8e7d6c-1234");

  // absent block → null; other app's block → null
  assert.equal(extractEmbedExtensionUuid(settingsWith(null), HANDLE), null);
  assert.equal(
    extractEmbedExtensionUuid(
      settingsWith({ type: "shopify://apps/other/blocks/foo/uuid" }),
      HANDLE,
    ),
    null,
  );
});

test("resolveEmbedState: an unreadable (locked/denied) theme is tolerated — MAIN still resolves", () => {
  // The exact bug: one theme's settings_data.json is ACCESS_DENIED (→ null),
  // which used to abort the whole scan. MAIN's status must still come through.
  const state = resolveEmbedState(
    [
      { role: "MAIN", settings: themeSettings("019fcc26-7067") },
      { role: "DEMO", settings: null },
      { role: "UNPUBLISHED", settings: null },
    ],
    HANDLE,
  );
  assert.equal(state.embedStatus, "enabled");
  assert.equal(state.embedUuid, "019fcc26-7067");
  assert.equal(state.embedOnDraft, false);
});

test("resolveEmbedState: enabled only on a draft, not live → embedOnDraft, status from MAIN", () => {
  const state = resolveEmbedState(
    [
      { role: "MAIN", settings: JSON.stringify({ current: { blocks: {} } }) },
      { role: "UNPUBLISHED", settings: themeSettings("draft-uuid") },
    ],
    HANDLE,
  );
  assert.equal(state.embedStatus, "unknown"); // not on the live theme
  assert.equal(state.embedOnDraft, true);
  assert.equal(state.embedUuid, "draft-uuid"); // deep link still works
});

test("resolveEmbedState: disabled on MAIN is reported as disabled, not overridden by a draft", () => {
  const state = resolveEmbedState(
    [
      { role: "MAIN", settings: themeSettings("main-uuid", true) },
      { role: "DEVELOPMENT", settings: themeSettings("dev-uuid") },
    ],
    HANDLE,
  );
  assert.equal(state.embedStatus, "disabled");
  assert.equal(state.embedUuid, "main-uuid"); // MAIN's uuid preferred
});

test("resolveEmbedState: nothing readable → all-unknown, no crash", () => {
  const state = resolveEmbedState(
    [
      { role: "MAIN", settings: null },
      { role: "DEMO", settings: null },
    ],
    HANDLE,
  );
  assert.equal(state.embedStatus, "unknown");
  assert.equal(state.embedUuid, null);
  assert.equal(state.embedOnDraft, false);
});

test("isEmptyStore is true only when there are zero orders", () => {
  assert.equal(isEmptyStore(0), true);
  assert.equal(isEmptyStore(1), false);
  assert.equal(isEmptyStore(42), false);
});
