import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cartEventEnabled,
  resolveToastConfig,
} from "../../src/toasts/config.defaults.ts";
import {
  describeAntiSpam,
  describeCartEvents,
  describeExclusions,
  describeLook,
  describeNotificationRule,
  describePlacement,
  describeTargeting,
  describeTiming,
  describeTypeStyle,
  humanDuration,
  joinSummary,
  positionLabel,
} from "../../src/toasts/describe.ts";

test("humanDuration renders human units, never raw milliseconds (§4)", () => {
  assert.equal(humanDuration(5000), "5 s");
  assert.equal(humanDuration(1500), "1.5 s");
  assert.equal(humanDuration(120_000), "2 min");
  assert.equal(humanDuration(90_000), "1.5 min");
  // Degenerate input must not leak "NaN s" into a section header.
  assert.equal(humanDuration(0), "0 s");
  assert.equal(humanDuration(-1), "0 s");
  assert.equal(humanDuration(Number.NaN), "0 s");
});

test("joinSummary drops empty parts so a summary never shows a dangling separator", () => {
  assert.equal(joinSummary(["Light", null, "12 px corners", false, ""]), "Light · 12 px corners");
  assert.equal(joinSummary([null, false]), "");
});

test("positionLabel never renders a raw enum key (§4c)", () => {
  assert.equal(positionLabel("bottom-right"), "Bottom right");
  assert.equal(positionLabel("top-center"), "Top centre");
  assert.equal(positionLabel("middle-left"), "Middle left");
});

test("describePlacement states position, edge distance and stack cap", () => {
  const config = resolveToastConfig({});
  const summary = describePlacement({
    ...config.global,
    position: "bottom-right",
    offsetTop: 40,
    offsetInline: 24,
    maxVisible: 3,
  });
  assert.equal(summary, "Bottom right · 40 px from the edge · up to 3 at once");
});

test("describePlacement says 'one at a time' rather than 'up to 1 at once'", () => {
  const config = resolveToastConfig({});
  const summary = describePlacement({
    ...config.global,
    position: "top-left",
    offsetTop: 0,
    offsetInline: 0,
    maxVisible: 1,
  });
  assert.equal(summary, "Top left · 0 px from the edge · one at a time");
});

test("describeTiming never quotes a duration when auto-dismiss is off (§12 — no false claim)", () => {
  const config = resolveToastConfig({});
  const off = describeTiming({
    ...config.global,
    autoDismiss: false,
    durationMs: 5000,
    closeable: true,
    pauseOnHover: true,
  });
  assert.equal(off, "Stays until dismissed · closeable");
  assert.ok(!off.includes("5 s"));

  const on = describeTiming({
    ...config.global,
    autoDismiss: true,
    durationMs: 5000,
    closeable: true,
    pauseOnHover: true,
  });
  assert.equal(on, "Stays 5 s · closeable · pauses on hover");
});

test("describeAntiSpam lets quiet mode override everything else", () => {
  const config = resolveToastConfig({});
  const quiet = describeAntiSpam({
    ...config.global,
    frequency: { ...config.global.frequency, quietMode: true, maxPerSession: 8 },
    grouping: { ...config.global.grouping, mode: "by-product" },
  });
  assert.equal(quiet, "Quiet mode — no toasts are showing");
  assert.ok(!quiet.includes("by-product"));
  assert.ok(!quiet.includes("8"));
});

test("describeAntiSpam names the merge mode in words and reports the cap honestly", () => {
  const config = resolveToastConfig({});
  const base = {
    ...config.global,
    frequency: { ...config.global.frequency, quietMode: false, maxPerSession: 8 },
  };
  assert.equal(
    describeAntiSpam({ ...base, grouping: { ...base.grouping, mode: "by-product" } }),
    "Merged by product · max 8 per session",
  );
  assert.equal(
    describeAntiSpam({ ...base, grouping: { ...base.grouping, mode: "off" } }),
    "Not merged · max 8 per session",
  );
  // 0 means unlimited in the data model — say so, don't print "max 0".
  assert.equal(
    describeAntiSpam({
      ...base,
      frequency: { ...base.frequency, maxPerSession: 0 },
      grouping: { ...base.grouping, mode: "by-type" },
    }),
    "Merged by event type · no session cap",
  );
});

test("describeLook summarises the visual mode without a raw enum", () => {
  const config = resolveToastConfig({});
  assert.equal(
    describeLook({ ...config.theme, mode: "light", cornerRadius: 12, shadow: "md" }),
    "Light · 12 px corners · medium shadow",
  );
  assert.equal(
    describeLook({ ...config.theme, mode: "system", cornerRadius: 0, shadow: "none" }),
    "Follows the shopper's light/dark · 0 px corners · no shadow",
  );
});

test("describeTargeting is honest that no pages selected means every page", () => {
  const config = resolveToastConfig({});
  assert.equal(
    describeTargeting({ ...config.targeting, pages: [], device: "both", customerState: "both" }),
    "Every page",
  );
  assert.equal(
    describeTargeting({
      ...config.targeting,
      pages: ["product", "collection"],
      device: "mobile",
      customerState: "guest",
    }),
    "2 page types · mobile only · guests only",
  );
});

test("describeTargeting uses the caller's page labels for a single page (§4c)", () => {
  const config = resolveToastConfig({});
  assert.equal(
    describeTargeting(
      { ...config.targeting, pages: ["product"], device: "both", customerState: "both" },
      (p) => (p === "product" ? "Product pages" : p),
    ),
    "Product pages",
  );
});

test("describeExclusions reports nothing excluded rather than an empty string", () => {
  assert.equal(describeExclusions({ pages: [], urls: [] }), "Nothing excluded");
  assert.equal(
    describeExclusions({ pages: ["cart", "home"], urls: ["/checkout*"] }),
    "2 page types · 1 URL",
  );
  assert.equal(
    describeExclusions({ pages: [], urls: ["/a", "/b"] }),
    "2 URLs",
  );
});

test("describeTypeStyle tells the truth about inheriting vs overriding (§9d)", () => {
  const config = resolveToastConfig({ plan: "pro" });
  assert.equal(describeTypeStyle(config, "cart"), "Inherits your global design");

  const customised = resolveToastConfig({
    plan: "pro",
    byType: {
      announcement: {
        theme: { mode: "dark" },
        behavior: { durationMs: 3000 },
      },
    },
  });
  const summary = describeTypeStyle(customised, "announcement");
  assert.equal(summary, "Custom: Dark, stays 3 s");
  // Other types must still read as inheriting.
  assert.equal(describeTypeStyle(customised, "cart"), "Inherits your global design");
});

test("describeTypeStyle still says 'customised' for an override it doesn't itemise", () => {
  const config = resolveToastConfig({
    plan: "pro",
    byType: { countdown: { theme: { backdropBlur: true } } },
  });
  assert.equal(describeTypeStyle(config, "countdown"), "Customised for this toast");
});

test("describeNotificationRule leads with Off so state never has to be inferred", () => {
  assert.equal(
    describeNotificationRule({
      id: "stock.low",
      type: "stock.low",
      enabled: false,
      surface: "inline",
      pages: [],
      message: "",
      threshold: 5,
    }),
    "Off · Shows when stock is 5 or fewer",
  );
  assert.equal(
    describeNotificationRule({
      id: "stock.low",
      type: "stock.low",
      enabled: true,
      surface: "inline",
      pages: [],
      message: "",
      threshold: 3,
    }),
    "Shows when stock is 3 or fewer",
  );
});

test("describeNotificationRule reports countdown mode in human units", () => {
  assert.equal(
    describeNotificationRule({
      id: "countdown",
      type: "countdown",
      enabled: true,
      surface: "banner",
      pages: [],
      message: "",
      evergreenMs: 24 * 3_600_000,
    }),
    "24 h rolling window per visitor",
  );
  assert.equal(
    describeNotificationRule({
      id: "countdown",
      type: "countdown",
      enabled: true,
      surface: "banner",
      pages: [],
      message: "",
      endsAt: "2026-09-01T00:00:00.000Z",
    }),
    "Ends 2026-09-01 for everyone",
  );
  // A countdown with neither is honest about it rather than inventing a deadline.
  assert.equal(
    describeNotificationRule({
      id: "countdown",
      type: "countdown",
      enabled: true,
      surface: "banner",
      pages: [],
      message: "",
    }),
    "No deadline set",
  );
});

test("describeNotificationRule surfaces the social-proof privacy choices", () => {
  assert.equal(
    describeNotificationRule({
      id: "order.created",
      type: "order.created",
      enabled: true,
      surface: "toast",
      pages: [],
      message: "",
      showName: true,
      showCity: false,
      minOrders: 5,
    }),
    "Starts after 5 real orders · shows first name",
  );
  assert.equal(
    describeNotificationRule({
      id: "order.created",
      type: "order.created",
      enabled: true,
      surface: "toast",
      pages: [],
      message: "",
      showName: false,
      showCity: false,
      minOrders: 5,
    }),
    "Starts after 5 real orders · shows the product only",
  );
});

test("describeNotificationRule is honest about a rule that doesn't exist yet", () => {
  assert.equal(describeNotificationRule(undefined), "Not set up yet");
});

test("describeCartEvents reports coverage, not a schema dump", () => {
  const config = resolveToastConfig({});
  const allOn = describeCartEvents(config, cartEventEnabled);
  assert.match(allOn, /^\d of 4 cart events on/);
});
