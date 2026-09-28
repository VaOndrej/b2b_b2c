import { test, type Page, type Response } from "@playwright/test";

export const EXPECTED_SHOP = "b2b-b2c-store-development.myshopify.com";
export const EXPECTED_THEME_ID = "161957216497";

export type EnvironmentClassification =
  | "NORMAL_STOREFRONT"
  | "ENV_429"
  | "ENV_AUTH"
  | "ENV_CHALLENGE"
  | "ENV_SHOPIFY_ERROR"
  | "ENV_THEME"
  | "ENV_NAVIGATION";

export type StorefrontSnapshot = {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  title: string;
  bodyExcerpt: string;
  shop: string | null;
  themeId: string | null;
  hasWonMarker: boolean;
  retryAfter: string | null;
  contentType: string | null;
};

const AUTH_RE =
  /(?:\bunauthori[sz]ed\b|log\s*in\s+to\s+continue|storefront password|\/password(?:\?|$))/i;
const CHALLENGE_RE =
  /connection needs to be verified|verify (?:that )?you are human|captcha|challenge/i;
const ERROR_RE =
  /there was a problem loading this website|something went wrong|failed to upload theme files|render\s*502|please try again in a few minutes/i;
const THEME_RE =
  /development theme.{0,30}(?:unavailable|expired|not found)|preview theme.{0,30}(?:unavailable|expired|not found)/i;

export function themeIdFromServerTiming(
  value: string | undefined,
): string | null {
  return value?.match(/(?:^|,\s*)theme;desc="?(\d+)"?/i)?.[1] ?? null;
}

export function classifyStorefrontSnapshot(
  snapshot: StorefrontSnapshot,
): EnvironmentClassification {
  const text = `${snapshot.finalUrl}\n${snapshot.title}\n${snapshot.bodyExcerpt}`;
  if (snapshot.status === 429) return "ENV_429";
  if (AUTH_RE.test(text)) return "ENV_AUTH";
  if (CHALLENGE_RE.test(text)) return "ENV_CHALLENGE";
  if (THEME_RE.test(text)) return "ENV_THEME";
  if (snapshot.status === null || snapshot.status >= 500 || ERROR_RE.test(text))
    return "ENV_SHOPIFY_ERROR";
  if (snapshot.shop !== EXPECTED_SHOP) return "ENV_THEME";
  if (
    (snapshot.themeId && snapshot.themeId !== EXPECTED_THEME_ID) ||
    !snapshot.hasWonMarker
  )
    return "ENV_THEME";
  return "NORMAL_STOREFRONT";
}

function redirectChain(response: Response | null) {
  const chain: Array<{ method: string; url: string }> = [];
  let request = response?.request() ?? null;
  while (request) {
    chain.unshift({ method: request.method(), url: request.url() });
    request = request.redirectedFrom();
  }
  return chain;
}

async function safePageState(
  page: Page,
  response: Response | null,
  requestedUrl: string,
) {
  const headers = response?.headers() ?? {};
  const pageState = await page
    .evaluate(() => ({
      shop: (window as any).Shopify?.shop ?? null,
      bodyExcerpt: document.body?.innerText?.slice(0, 1200) ?? "",
      hasWonMarker: Boolean(
        document.querySelector(
          'link[href*="won-tokens.css"], script[src*="won-cart.js"], .won-section, [data-won-stepper]',
        ),
      ),
    }))
    .catch(() => ({ shop: null, bodyExcerpt: "", hasWonMarker: false }));
  const snapshot: StorefrontSnapshot = {
    requestedUrl,
    finalUrl: page.url(),
    status: response?.status() ?? null,
    title: await page.title().catch(() => ""),
    bodyExcerpt: pageState.bodyExcerpt,
    shop: pageState.shop,
    themeId: themeIdFromServerTiming(headers["server-timing"]),
    hasWonMarker: pageState.hasWonMarker,
    retryAfter: headers["retry-after"] ?? null,
    contentType: headers["content-type"] ?? null,
  };
  const cookies = await page
    .context()
    .cookies()
    .catch(() => []);
  return {
    classification: classifyStorefrontSnapshot(snapshot),
    snapshot,
    redirects: redirectChain(response),
    cookies: cookies.map(
      ({ name, domain, path, expires, httpOnly, secure, sameSite }) => ({
        name,
        domain,
        path,
        expires,
        httpOnly,
        secure,
        sameSite,
      }),
    ),
  };
}

export async function attachEnvironmentEvidence(
  name: string,
  evidence: unknown,
) {
  await test.info().attach(name, {
    contentType: "application/json",
    body: JSON.stringify(evidence, null, 2),
  });
}

export async function gotoStorefront(page: Page, url: string) {
  let response: Response | null = null;
  try {
    response = await page.goto(url, { waitUntil: "load" });
  } catch (error) {
    const evidence = {
      classification: "ENV_NAVIGATION" as const,
      requestedUrl: url,
      finalUrl: page.url(),
      error: error instanceof Error ? error.message : String(error),
    };
    await attachEnvironmentEvidence(
      "storefront-environment-evidence",
      evidence,
    );
    throw new Error(`[ENV_NAVIGATION] ${evidence.error}`);
  }
  const evidence = await safePageState(page, response, url);
  if (evidence.classification !== "NORMAL_STOREFRONT") {
    await attachEnvironmentEvidence(
      "storefront-environment-evidence",
      evidence,
    );
    throw new Error(
      `[${evidence.classification}] ${evidence.snapshot.status ?? "no HTTP status"} ${evidence.snapshot.finalUrl}` +
        (evidence.snapshot.retryAfter
          ? ` (Retry-After: ${evidence.snapshot.retryAfter})`
          : ""),
    );
  }
  return response;
}

export async function assertCartBrowserResponse(
  response: Response,
  label: string,
) {
  const headers = response.headers();
  const body = await response.text().catch(() => "");
  const evidence = {
    label,
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
    retryAfter: headers["retry-after"] ?? null,
    contentType: headers["content-type"] ?? null,
    bodyExcerpt: body.slice(0, 1200),
  };
  let classification: EnvironmentClassification | null = null;
  if (response.status() === 429) classification = "ENV_429";
  else if (
    response.status() === 401 ||
    response.status() === 403 ||
    AUTH_RE.test(body)
  )
    classification = "ENV_AUTH";
  else if (response.status() >= 500 || ERROR_RE.test(body))
    classification = "ENV_SHOPIFY_ERROR";
  if (classification) {
    await attachEnvironmentEvidence("cart-environment-evidence", {
      classification,
      ...evidence,
    });
    throw new Error(
      `[${classification}] ${label} ${evidence.method} ${evidence.url} returned HTTP ${evidence.status}` +
        (evidence.retryAfter ? ` (Retry-After: ${evidence.retryAfter})` : ""),
    );
  }
  if (!response.ok())
    throw new Error(
      `${label} returned HTTP ${evidence.status}: ${body.slice(0, 300)}`,
    );
  return body;
}
