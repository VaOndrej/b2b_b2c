import { expect, test } from "@playwright/test";
import {
  EXPECTED_SHOP,
  EXPECTED_THEME_ID,
  classifyStorefrontSnapshot,
  type StorefrontSnapshot,
} from "../support/storefront-environment";

const normal: StorefrontSnapshot = {
  requestedUrl: "/",
  finalUrl: "http://127.0.0.1:9292/",
  status: 200,
  title: "Won demo",
  bodyExcerpt: "Normal storefront content",
  shop: EXPECTED_SHOP,
  themeId: EXPECTED_THEME_ID,
  hasWonMarker: true,
  retryAfter: null,
  contentType: "text/html; charset=utf-8",
};

test("storefront environment guard accepts only the expected normal storefront", () => {
  expect(classifyStorefrontSnapshot(normal)).toBe("NORMAL_STOREFRONT");
  expect(
    classifyStorefrontSnapshot({ ...normal, themeId: "999999999999" }),
  ).toBe("ENV_THEME");
  expect(classifyStorefrontSnapshot({ ...normal, hasWonMarker: false })).toBe(
    "ENV_THEME",
  );
});

for (const [snapshot, expected] of [
  [{ ...normal, status: 429, retryAfter: "120" }, "ENV_429"],
  [{ ...normal, bodyExcerpt: '{"error":"unauthorized"}' }, "ENV_AUTH"],
  [
    {
      ...normal,
      title: "Your connection needs to be verified before you can proceed",
    },
    "ENV_CHALLENGE",
  ],
  [
    {
      ...normal,
      status: 502,
      title: "There was a problem loading this website",
    },
    "ENV_SHOPIFY_ERROR",
  ],
] as const) {
  test(`storefront environment guard identifies ${expected}`, () => {
    expect(classifyStorefrontSnapshot(snapshot)).toBe(expected);
  });
}
