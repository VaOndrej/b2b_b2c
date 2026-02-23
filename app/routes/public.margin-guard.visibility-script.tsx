import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig } from "../services/margin-guard-config.server";

function escapeForJsString(input: string): string {
  return JSON.stringify(String(input ?? ""));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { liquid } = await authenticate.public.appProxy(request);
  const config = await getOrCreateMarginGuardConfig();
  const url = new URL(request.url);
  const proxyPrefix = String(url.searchParams.get("path_prefix") ?? "/apps/margin-guard");
  const script = `
(() => {
  const PROXY_PREFIX = ${escapeForJsString(proxyPrefix)};
  const VISIBILITY_ENDPOINT = PROXY_PREFIX + "/visibility";
  const B2B_TAG = ${escapeForJsString(config.b2bTag.trim().toLowerCase() || "b2b")};
  const LOCALE = String({{ localization.language.iso_code | json }} || "en").toLowerCase();
  const MESSAGES = {
    en: "This product is not available for your customer segment.",
    cs: "Tento produkt neni dostupny pro vas zakaznicky segment.",
  };

  function messageForLocale() {
    return LOCALE.startsWith("cs") ? MESSAGES.cs : MESSAGES.en;
  }

  function extractHandleFromPath(pathname) {
    if (!pathname) {
      return null;
    }
    const match = String(pathname).match(/\\/products\\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]).toLowerCase() : null;
  }

  function extractHandleFromUrl(href) {
    try {
      const parsed = new URL(href, window.location.origin);
      return extractHandleFromPath(parsed.pathname);
    } catch {
      return null;
    }
  }

  function collectHandles() {
    const handles = new Set();
    const currentHandle = extractHandleFromPath(window.location.pathname);
    if (currentHandle) {
      handles.add(currentHandle);
    }
    for (const anchor of document.querySelectorAll("a[href*='/products/']")) {
      const handle = extractHandleFromUrl(anchor.getAttribute("href") || "");
      if (handle) {
        handles.add(handle);
      }
    }
    return Array.from(handles);
  }

  function detectSegmentFromCustomerTags() {
    const rawTags = String({{ customer.tags | join: "," | downcase | json }} || "");
    const tags = rawTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return tags.includes(B2B_TAG) ? "B2B" : "B2C";
  }

  function hideCardForHandle(handle) {
    for (const anchor of document.querySelectorAll("a[href*='/products/']")) {
      const anchorHandle = extractHandleFromUrl(anchor.getAttribute("href") || "");
      if (anchorHandle !== handle) {
        continue;
      }
      const card =
        anchor.closest("[data-product-card]") ||
        anchor.closest(".product-card") ||
        anchor.closest(".card") ||
        anchor.closest(".grid__item") ||
        anchor.closest(".product-item") ||
        anchor.closest("article") ||
        anchor.closest("li") ||
        anchor;
      if (card instanceof HTMLElement) {
        card.style.display = "none";
      }
    }
  }

  function blockCurrentProductPage(handle) {
    const currentHandle = extractHandleFromPath(window.location.pathname);
    if (!currentHandle || currentHandle !== handle) {
      return;
    }

    for (const form of document.querySelectorAll("form[action*='/cart/add']")) {
      if (!(form instanceof HTMLFormElement)) {
        continue;
      }
      for (const button of form.querySelectorAll("button, input[type='submit']")) {
        if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
          button.disabled = true;
        }
      }
    }

    const existingBanner = document.getElementById("margin-guard-visibility-banner");
    if (existingBanner) {
      return;
    }

    const banner = document.createElement("div");
    banner.id = "margin-guard-visibility-banner";
    banner.style.padding = "12px";
    banner.style.margin = "12px 0";
    banner.style.border = "1px solid #b42318";
    banner.style.background = "#fef3f2";
    banner.style.color = "#7a271a";
    banner.style.fontSize = "14px";
    banner.textContent = messageForLocale();
    const target =
      document.querySelector("main") ||
      document.querySelector("#MainContent") ||
      document.body;
    target?.prepend(banner);
  }

  async function run() {
    const handles = collectHandles();
    if (!handles.length) {
      return;
    }

    const segment = detectSegmentFromCustomerTags();
    const params = new URLSearchParams({
      handles: handles.join(","),
      segment,
    });
    const response = await fetch(VISIBILITY_ENDPOINT + "?" + params.toString(), {
      credentials: "same-origin",
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    const hiddenHandles = Array.isArray(payload?.hiddenHandles)
      ? payload.hiddenHandles.map((value) => String(value).toLowerCase())
      : [];
    for (const handle of hiddenHandles) {
      hideCardForHandle(handle);
      blockCurrentProductPage(handle);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      run().catch(() => {});
    }, { once: true });
  } else {
    run().catch(() => {});
  }
})();
  `;

  return liquid(script, {
    layout: false,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
};
