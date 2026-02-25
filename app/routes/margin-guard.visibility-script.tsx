import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

function escapeForJsString(input: string): string {
  return JSON.stringify(String(input ?? ""));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const defaultProxyPrefix = "/apps/margin-guard";
  const script = `
(() => {
  const DEFAULT_PROXY_PREFIX = ${escapeForJsString(defaultProxyPrefix)};
  const MESSAGES = {
    en: {
      visibility: "This product is not available for your customer segment.",
      pdpStepPrefix: "This product is sold in multiples of ",
      pdpStepSuffix: ".",
      pdpMoqPrefix: "Minimum order quantity: ",
      pdpMoqSuffix: ".",
      cartMaxPrefix: "Maximum allowed quantity for your account is ",
      cartMaxSuffix: ". Quantity was adjusted automatically.",
      cartMaxProductPrefix: " Product: ",
      cartMaxProductSuffix: ".",
      moqRemoveBlockedPrefix: "Minimum order quantity is ",
      moqRemoveBlockedSuffix:
        ". If you wish to delete the product, press the trash icon.",
    },
    cs: {
      visibility: "Tento produkt neni dostupny pro vas zakaznicky segment.",
      pdpStepPrefix: "Tento produkt se prodava v nasobcich ",
      pdpStepSuffix: ".",
      pdpMoqPrefix: "Minimalni odebrane mnozstvi: ",
      pdpMoqSuffix: ".",
      cartMaxPrefix: "Maximalni povolene mnozstvi pro vas ucet je ",
      cartMaxSuffix: ". Mnozstvi bylo automaticky upraveno.",
      cartMaxProductPrefix: " Produkt: ",
      cartMaxProductSuffix: ".",
      moqRemoveBlockedPrefix: "Minimalni odebrane mnozstvi je ",
      moqRemoveBlockedSuffix:
        ". Pokud chcete produkt odebrat, pouzijte ikonu popelnice.",
    },
  };
  const state = {
    quantityConstraintsByHandle: {},
    quantityConstraintsByProductId: {},
    cartLineHandleByIndex: {},
    cartLineProductIdByIndex: {},
    cartLineQuantityByIndex: {},
    cartLineKeyByIndex: {},
    cartLineVariantIdByIndex: {},
    cartLineIndexByKey: {},
    cartLineIndexByVariantId: {},
    cartLineProductIdByKey: {},
    cartLineProductIdByVariantId: {},
    cartLineQuantityByKey: {},
    cartLineQuantityByVariantId: {},
    rulesConfigVersion: null,
    currentProductId: null,
    allowRemoveAtMinimumOrderQuantity: true,
  };
  const RULES_CACHE_KEY = "marginGuardRulesCache_v1";
  const RULES_CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_RULES_READY_WAIT_MS = 300;
  const MIN_CART_SNAPSHOT_REFRESH_INTERVAL_MS = 180;
  let initialRulesBootstrapPromise = null;
  let initialRulesBootstrapCompleted = false;
  let cartSnapshotRefreshPromise = null;
  let lastCartSnapshotRefreshAt = 0;
  let cartQuantityNoticeTimeout = null;
  let lastCartQuantityNotice = "";
  let lastCartQuantityNoticeAt = 0;

  function resolveScriptElement() {
    if (document.currentScript instanceof HTMLScriptElement) {
      return document.currentScript;
    }
    return document.querySelector("script[data-margin-guard-visibility-script]");
  }

  function readProxyParam(name) {
    const scriptEl = resolveScriptElement();
    if (!(scriptEl instanceof HTMLScriptElement)) {
      return "";
    }
    try {
      const parsed = new URL(scriptEl.src, window.location.origin);
      return String(parsed.searchParams.get(name) || "").trim();
    } catch {
      return "";
    }
  }

  const proxyPrefix = readProxyParam("path_prefix") || DEFAULT_PROXY_PREFIX;
  const visibilityEndpoint = proxyPrefix + "/visibility";
  const loggedInCustomerId = readProxyParam("logged_in_customer_id");

  function resolveLocaleMessages() {
    const lang = String(
      document.documentElement?.lang ||
        navigator.language ||
        "en",
    ).toLowerCase();
    return lang.startsWith("cs") ? MESSAGES.cs : MESSAGES.en;
  }

  function messageForLocale(key) {
    const localeMessages = resolveLocaleMessages();
    const fallbackMessages = MESSAGES.en;
    return localeMessages[key] || fallbackMessages[key] || "";
  }

  function messageForPdpStepQuantity(stepQuantity) {
    return (
      messageForLocale("pdpStepPrefix") +
      String(stepQuantity) +
      messageForLocale("pdpStepSuffix")
    );
  }

  function messageForPdpMinimumOrderQuantity(minimumOrderQuantity) {
    return (
      messageForLocale("pdpMoqPrefix") +
      String(minimumOrderQuantity) +
      messageForLocale("pdpMoqSuffix")
    );
  }

  function messageForCartMaximumQuantity(maximumOrderQuantity, productTitle) {
    const normalizedTitle = String(productTitle || "").trim();
    return (
      messageForLocale("cartMaxPrefix") +
      String(maximumOrderQuantity) +
      messageForLocale("cartMaxSuffix") +
      (normalizedTitle
        ? messageForLocale("cartMaxProductPrefix") +
          normalizedTitle +
          messageForLocale("cartMaxProductSuffix")
        : "")
    );
  }

  function messageForMoqRemoveBlocked(minimumOrderQuantity) {
    return (
      messageForLocale("moqRemoveBlockedPrefix") +
      String(minimumOrderQuantity) +
      messageForLocale("moqRemoveBlockedSuffix")
    );
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

  function normalizeHandle(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function normalizeProductId(raw) {
    const normalized = String(raw || "").trim();
    if (!normalized) {
      return null;
    }
    if (normalized.indexOf("gid://shopify/Product/") === 0) {
      return normalized;
    }
    if (/^\\d+$/.test(normalized)) {
      return "gid://shopify/Product/" + normalized;
    }
    return null;
  }

  function normalizeLineKey(raw) {
    const normalized = String(raw || "").trim();
    return normalized || null;
  }

  function normalizeVariantId(raw) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return String(Math.floor(parsed));
  }

  function resolveCurrentProductIdFromDom() {
    const globalMeta =
      window.meta &&
      window.meta.product &&
      window.meta.product.id != null
        ? normalizeProductId(window.meta.product.id)
        : null;
    if (globalMeta) {
      return globalMeta;
    }

    const selectors = [
      "form[action*='/cart/add'] input[name='product-id']",
      "form[action*='/cart/add'] input[name='product_id']",
      "[data-product-id]",
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      let rawValue = "";
      if (element instanceof HTMLInputElement) {
        rawValue = element.value;
      } else {
        rawValue =
          element.getAttribute("data-product-id") ||
          element.getAttribute("value") ||
          "";
      }
      const normalizedProductId = normalizeProductId(rawValue);
      if (normalizedProductId) {
        return normalizedProductId;
      }
    }

    return null;
  }

  function resolveShopifyRoot() {
    const rawRoot =
      window.Shopify &&
      window.Shopify.routes &&
      typeof window.Shopify.routes.root === "string"
        ? window.Shopify.routes.root
        : "/";
    const normalizedRoot = String(rawRoot || "/").trim();
    if (!normalizedRoot) {
      return "/";
    }
    return normalizedRoot.endsWith("/") ? normalizedRoot : normalizedRoot + "/";
  }

  async function fetchCartSnapshot() {
    const root = resolveShopifyRoot();
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = window.setTimeout(() => {
      if (controller) {
        controller.abort();
      }
    }, 1200);
    try {
      const response = await fetch(root + "cart.js", {
        credentials: "same-origin",
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        return null;
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildCartLineIndex(cart) {
    const lineHandleByIndex = {};
    const lineProductIdByIndex = {};
    const lineQuantityByIndex = {};
    const lineKeyByIndex = {};
    const lineVariantIdByIndex = {};
    const lineIndexByKey = {};
    const lineIndexByVariantId = {};
    const lineProductIdByKey = {};
    const lineProductIdByVariantId = {};
    const lineQuantityByKey = {};
    const lineQuantityByVariantId = {};
    const handles = [];
    const productIds = [];
    const items = Array.isArray(cart && cart.items) ? cart.items : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const handle = normalizeHandle(item && item.handle);
      const productId = normalizeProductId(
        item && item.product_id != null ? item.product_id : item && item.productId,
      );
      const lineIndex = index + 1;
      const lineQuantity = parsePositiveInt(
        item && item.quantity != null ? item.quantity : 1,
        1,
      );
      const lineKey = normalizeLineKey(item && item.key);
      const lineVariantId = normalizeVariantId(
        item && item.variant_id != null ? item.variant_id : item && item.id,
      );
      lineQuantityByIndex[lineIndex] = lineQuantity;
      if (lineKey) {
        lineKeyByIndex[lineIndex] = lineKey;
        lineIndexByKey[lineKey] = lineIndex;
        lineQuantityByKey[lineKey] = lineQuantity;
        if (productId) {
          lineProductIdByKey[lineKey] = productId;
        }
      }
      if (lineVariantId) {
        lineVariantIdByIndex[lineIndex] = lineVariantId;
        lineIndexByVariantId[lineVariantId] = lineIndex;
        lineQuantityByVariantId[lineVariantId] = lineQuantity;
        if (productId) {
          lineProductIdByVariantId[lineVariantId] = productId;
        }
      }
      if (!handle) {
        if (productId) {
          lineProductIdByIndex[lineIndex] = productId;
          productIds.push(productId);
        }
        continue;
      }
      lineHandleByIndex[lineIndex] = handle;
      handles.push(handle);
      if (productId) {
        lineProductIdByIndex[lineIndex] = productId;
        productIds.push(productId);
      }
    }
    return {
      handles,
      productIds,
      lineHandleByIndex,
      lineProductIdByIndex,
      lineQuantityByIndex,
      lineKeyByIndex,
      lineVariantIdByIndex,
      lineIndexByKey,
      lineIndexByVariantId,
      lineProductIdByKey,
      lineProductIdByVariantId,
      lineQuantityByKey,
      lineQuantityByVariantId,
    };
  }

  function applyCartLineContext(cartContext) {
    state.cartLineHandleByIndex = cartContext.lineHandleByIndex || {};
    state.cartLineProductIdByIndex = cartContext.lineProductIdByIndex || {};
    state.cartLineQuantityByIndex = cartContext.lineQuantityByIndex || {};
    state.cartLineKeyByIndex = cartContext.lineKeyByIndex || {};
    state.cartLineVariantIdByIndex = cartContext.lineVariantIdByIndex || {};
    state.cartLineIndexByKey = cartContext.lineIndexByKey || {};
    state.cartLineIndexByVariantId = cartContext.lineIndexByVariantId || {};
    state.cartLineProductIdByKey = cartContext.lineProductIdByKey || {};
    state.cartLineProductIdByVariantId = cartContext.lineProductIdByVariantId || {};
    state.cartLineQuantityByKey = cartContext.lineQuantityByKey || {};
    state.cartLineQuantityByVariantId = cartContext.lineQuantityByVariantId || {};
  }

  function resetCartLineContext() {
    applyCartLineContext({
      lineHandleByIndex: {},
      lineProductIdByIndex: {},
      lineQuantityByIndex: {},
      lineKeyByIndex: {},
      lineVariantIdByIndex: {},
      lineIndexByKey: {},
      lineIndexByVariantId: {},
      lineProductIdByKey: {},
      lineProductIdByVariantId: {},
      lineQuantityByKey: {},
      lineQuantityByVariantId: {},
    });
  }

  function collectCurrentProductIds() {
    const productIds = new Set();
    state.currentProductId = resolveCurrentProductIdFromDom();
    if (state.currentProductId) {
      productIds.add(state.currentProductId);
    }
    return Array.from(productIds);
  }

  async function enrichContextWithCartSnapshot(rawHandles, rawProductIds) {
    const handles = new Set(rawHandles);
    const productIds = new Set(rawProductIds);
    try {
      const cart = await fetchCartSnapshot();
      const cartContext = buildCartLineIndex(cart);
      applyCartLineContext(cartContext);
      for (const handle of cartContext.handles) {
        handles.add(handle);
      }
      for (const productId of cartContext.productIds) {
        productIds.add(productId);
      }
    } catch {
      resetCartLineContext();
    }
    return {
      handles: Array.from(handles),
      productIds: Array.from(productIds),
    };
  }

  function buildHandlesKey(handles) {
    return Array.from(new Set(handles.map(normalizeHandle)))
      .filter(Boolean)
      .sort()
      .join(",");
  }

  function buildProductIdsKey(productIds) {
    return Array.from(new Set(productIds.map(normalizeProductId)))
      .filter(Boolean)
      .sort()
      .join(",");
  }

  async function fetchAndApplyVisibilityPayload(handles, productIds) {
    if (!handles.length && !productIds.length) {
      return;
    }
    const params = new URLSearchParams();
    if (handles.length) {
      params.set("handles", handles.join(","));
    }
    if (productIds.length) {
      params.set("product_ids", productIds.join(","));
    }
    if (loggedInCustomerId) {
      params.set("logged_in_customer_id", loggedInCustomerId);
    }
    const response = await fetch(visibilityEndpoint + "?" + params.toString(), {
      credentials: "same-origin",
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    state.allowRemoveAtMinimumOrderQuantity =
      payload?.allowRemoveAtMinimumOrderQuantity !== false;
    const responseConfigVersion =
      String(payload?.configUpdatedAt || "").trim() || null;
    if (
      responseConfigVersion &&
      state.rulesConfigVersion &&
      state.rulesConfigVersion !== responseConfigVersion
    ) {
      state.quantityConstraintsByHandle = {};
      state.quantityConstraintsByProductId = {};
    }
    if (responseConfigVersion) {
      state.rulesConfigVersion = responseConfigVersion;
    }

    const responseQuantityConstraintsByHandle = normalizeQuantityRules(
      payload?.quantityConstraintsByHandle,
      normalizeHandle,
    );
    const responseQuantityConstraintsByProductId = normalizeQuantityRules(
      payload?.quantityConstraintsByProductId,
      normalizeProductId,
    );
    state.quantityConstraintsByHandle = {
      ...state.quantityConstraintsByHandle,
      ...responseQuantityConstraintsByHandle,
    };
    state.quantityConstraintsByProductId = {
      ...state.quantityConstraintsByProductId,
      ...responseQuantityConstraintsByProductId,
    };
    const hiddenHandles = Array.isArray(payload?.hiddenHandles)
      ? payload.hiddenHandles.map((value) => String(value).toLowerCase())
      : [];
    const mergedHiddenHandles = persistRulesCache(hiddenHandles);
    for (const handle of mergedHiddenHandles) {
      hideCardForHandle(handle);
      blockCurrentProductPage(handle);
    }
    enforceCurrentProductQuantityRule(state.quantityConstraintsByHandle);
    syncCartQuantityInputs(state.quantityConstraintsByHandle);
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
    banner.textContent = messageForLocale("visibility");
    const target =
      document.querySelector("main") ||
      document.querySelector("#MainContent") ||
      document.body;
    target?.prepend(banner);
  }

  function resolveCartQuantityNoticeHost() {
    const selectors = [
      "#CartDrawer .drawer__inner",
      "#CartDrawer .drawer__contents",
      "cart-drawer .drawer__inner",
      ".cart-drawer .drawer__inner",
      "cart-items",
      ".cart__items",
      "form[action*='/cart']",
    ];
    for (const selector of selectors) {
      const host = document.querySelector(selector);
      if (host instanceof HTMLElement) {
        return host;
      }
    }
    return document.querySelector("main") || document.body;
  }

  function normalizeProductTitle(rawTitle) {
    const normalizedTitle = String(rawTitle || "").replace(/\s+/g, " ").trim();
    return normalizedTitle || null;
  }

  function resolveProductTitleFromElement(element) {
    if (!(element instanceof Element)) {
      return null;
    }
    const containers = [
      element.closest("[data-cart-item]"),
      element.closest(".cart-item"),
      element.closest(".cart-drawer__item"),
      element.closest(".drawer__cart-item"),
      element.closest("li"),
      element.closest("tr"),
      element.closest("form"),
    ];
    const selectors = [
      "[data-cart-item-title]",
      "[data-product-title]",
      ".cart-item__name",
      ".cart-item__title",
      ".product-title",
      ".cart__product-title",
      ".cart__product-name",
      "a[href*='/products/']",
    ];
    for (const container of containers) {
      if (!(container instanceof Element)) {
        continue;
      }
      for (const selector of selectors) {
        const titleElement = container.querySelector(selector);
        if (!(titleElement instanceof HTMLElement)) {
          continue;
        }
        const title =
          normalizeProductTitle(
            titleElement.getAttribute("data-cart-item-title") ||
              titleElement.getAttribute("data-product-title") ||
              titleElement.textContent,
          ) || null;
        if (title) {
          return title;
        }
      }
    }
    return null;
  }

  function resolveCurrentProductTitleFromDom() {
    if (
      window.meta &&
      window.meta.product &&
      typeof window.meta.product.title === "string"
    ) {
      const metaTitle = normalizeProductTitle(window.meta.product.title);
      if (metaTitle) {
        return metaTitle;
      }
    }
    const selectors = [
      "[data-product-title]",
      ".product__title",
      ".product-single__title",
      "main h1",
      "h1",
    ];
    for (const selector of selectors) {
      const titleElement = document.querySelector(selector);
      if (!(titleElement instanceof HTMLElement)) {
        continue;
      }
      const title = normalizeProductTitle(
        titleElement.getAttribute("data-product-title") || titleElement.textContent,
      );
      if (title) {
        return title;
      }
    }
    return null;
  }

  function showCartQuantityNotice(message) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
      return;
    }
    const now = Date.now();
    if (
      normalizedMessage === lastCartQuantityNotice &&
      now - lastCartQuantityNoticeAt < 1200
    ) {
      return;
    }
    lastCartQuantityNotice = normalizedMessage;
    lastCartQuantityNoticeAt = now;
    const host = resolveCartQuantityNoticeHost();
    if (!(host instanceof HTMLElement)) {
      return;
    }
    let notice = document.getElementById("margin-guard-cart-quantity-notice");
    if (!(notice instanceof HTMLElement)) {
      notice = document.createElement("div");
      notice.id = "margin-guard-cart-quantity-notice";
      notice.setAttribute("data-margin-guard-cart-quantity-notice", "1");
      notice.style.padding = "10px 12px";
      notice.style.margin = "0 0 12px";
      notice.style.border = "1px solid #f04438";
      notice.style.borderRadius = "6px";
      notice.style.background = "#fef3f2";
      notice.style.color = "#7a271a";
      notice.style.fontSize = "13px";
      notice.style.lineHeight = "1.4";
    }
    notice.textContent = normalizedMessage;
    host.prepend(notice);
    if (cartQuantityNoticeTimeout != null) {
      clearTimeout(cartQuantityNoticeTimeout);
    }
    cartQuantityNoticeTimeout = window.setTimeout(() => {
      cartQuantityNoticeTimeout = null;
      if (notice && notice.parentElement) {
        notice.parentElement.removeChild(notice);
      }
    }, 4500);
  }

  function maybeShowMaximumQuantityAdjustmentNotice(
    rawRequestedQuantity,
    normalizedQuantity,
    maximumOrderQuantity,
    productTitle,
  ) {
    const maxQuantity = parseOptionalPositiveInt(maximumOrderQuantity);
    if (maxQuantity == null) {
      return;
    }
    const requestedQuantity = parseInteger(rawRequestedQuantity, maxQuantity);
    const normalized = parseInteger(normalizedQuantity, maxQuantity);
    if (requestedQuantity <= maxQuantity) {
      return;
    }
    if (normalized > maxQuantity) {
      return;
    }
    showCartQuantityNotice(
      messageForCartMaximumQuantity(maxQuantity, productTitle),
    );
  }

  function maybeShowMoqRemovalBlockedNotice(
    rawRequestedQuantity,
    normalizedQuantity,
    currentQuantity,
    minimumOrderQuantity,
  ) {
    if (state.allowRemoveAtMinimumOrderQuantity !== false) {
      return;
    }
    const minimum = parsePositiveInt(minimumOrderQuantity, 1);
    const current = Math.max(0, parseInteger(currentQuantity, 0));
    const requested = parseInteger(rawRequestedQuantity, current);
    const normalized = Math.max(0, parseInteger(normalizedQuantity, 0));
    if (current > minimum) {
      return;
    }
    if (requested >= minimum) {
      return;
    }
    if (normalized !== minimum) {
      return;
    }
    showCartQuantityNotice(messageForMoqRemoveBlocked(minimum));
  }

  function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  function parseOptionalPositiveInt(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return null;
    }
    return Math.floor(parsed);
  }

  function parseInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  function resolveInputStockMax(input) {
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    const cachedStockMax = parseOptionalPositiveInt(input.dataset.marginGuardStockMax);
    if (cachedStockMax != null) {
      return cachedStockMax;
    }
    const candidates = [
      input.getAttribute("data-margin-guard-stock-max"),
      input.getAttribute("max"),
      input.max,
      input.getAttribute("data-max"),
      input.getAttribute("data-quantity-max"),
      input.getAttribute("data-inventory-quantity"),
      input.getAttribute("data-stock"),
      input.getAttribute("data-available"),
      input.dataset.max,
      input.dataset.quantityMax,
      input.dataset.inventoryQuantity,
    ];
    const container = input.closest(
      "[data-max], [data-quantity-max], [data-inventory-quantity], [data-stock], [data-available]",
    );
    if (container instanceof Element) {
      candidates.push(
        container.getAttribute("data-max"),
        container.getAttribute("data-quantity-max"),
        container.getAttribute("data-inventory-quantity"),
        container.getAttribute("data-stock"),
        container.getAttribute("data-available"),
      );
    }
    for (const candidate of candidates) {
      const parsed = parseOptionalPositiveInt(candidate);
      if (parsed != null) {
        input.dataset.marginGuardStockMax = String(parsed);
        return parsed;
      }
    }
    return null;
  }

  function resolveEffectiveMaxForRule(rule, stockMaxQuantity) {
    const configuredMax = parseOptionalPositiveInt(rule.maxOrderQuantity);
    const stockMax = parseOptionalPositiveInt(stockMaxQuantity);
    const combinedMax =
      configuredMax != null && stockMax != null
        ? Math.min(configuredMax, stockMax)
        : configuredMax != null
          ? configuredMax
          : stockMax;
    if (combinedMax == null) {
      return null;
    }
    if (rule.stepQuantity <= 1) {
      return combinedMax;
    }
    const steppedMax =
      Math.floor(combinedMax / rule.stepQuantity) * rule.stepQuantity;
    if (steppedMax < 1) {
      return null;
    }
    return steppedMax;
  }

  function resolveEffectiveMaxForInput(input, rule) {
    return resolveEffectiveMaxForRule(rule, resolveInputStockMax(input));
  }

  function normalizeQuantityRule(rule) {
    if (!rule || typeof rule !== "object") {
      return null;
    }
    const minimumOrderQuantity = parsePositiveInt(rule.minimumOrderQuantity, 1);
    const rawStep = parsePositiveInt(rule.stepQuantity, 1);
    const stepQuantity = rawStep > 1 ? rawStep : 1;
    const maxOrderQuantity = parseOptionalPositiveInt(rule.maxOrderQuantity);
    if (
      minimumOrderQuantity <= 1 &&
      stepQuantity <= 1 &&
      maxOrderQuantity == null
    ) {
      return null;
    }
    return {
      minimumOrderQuantity,
      stepQuantity,
      maxOrderQuantity,
    };
  }

  function normalizeQuantityRules(rawValue, keyNormalizer) {
    const result = {};
    if (!rawValue || typeof rawValue !== "object") {
      return result;
    }
    for (const [rawHandle, rawRule] of Object.entries(rawValue)) {
      const handle = keyNormalizer(rawHandle);
      const normalizedRule = normalizeQuantityRule(rawRule);
      if (!handle || !normalizedRule) {
        continue;
      }
      result[handle] = normalizedRule;
    }
    return result;
  }

  function mergeUniqueStringArrays(firstValues, secondValues) {
    const values = new Set();
    const appendValues = (sourceValues) => {
      if (!Array.isArray(sourceValues)) {
        return;
      }
      for (const sourceValue of sourceValues) {
        const normalized = String(sourceValue || "").trim().toLowerCase();
        if (normalized) {
          values.add(normalized);
        }
      }
    };
    appendValues(firstValues);
    appendValues(secondValues);
    return Array.from(values);
  }

  function readRulesCache() {
    if (typeof window.sessionStorage === "undefined") {
      return null;
    }
    try {
      const rawValue = window.sessionStorage.getItem(RULES_CACHE_KEY);
      if (!rawValue) {
        return null;
      }
      const parsed = JSON.parse(rawValue);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const fetchedAt = Number(parsed.fetchedAt);
      if (
        !Number.isFinite(fetchedAt) ||
        Date.now() - fetchedAt > RULES_CACHE_TTL_MS
      ) {
        return null;
      }
      const customerScope = String(parsed.customerScope || "");
      if (customerScope !== String(loggedInCustomerId || "")) {
        return null;
      }
      return {
        configVersion: String(parsed.configVersion || "").trim() || null,
        allowRemoveAtMinimumOrderQuantity:
          parsed.allowRemoveAtMinimumOrderQuantity !== false,
        quantityConstraintsByHandle:
          parsed.quantityConstraintsByHandle &&
          typeof parsed.quantityConstraintsByHandle === "object"
            ? parsed.quantityConstraintsByHandle
            : {},
        quantityConstraintsByProductId:
          parsed.quantityConstraintsByProductId &&
          typeof parsed.quantityConstraintsByProductId === "object"
            ? parsed.quantityConstraintsByProductId
            : {},
        hiddenHandles: Array.isArray(parsed.hiddenHandles)
          ? parsed.hiddenHandles
          : [],
      };
    } catch {
      return null;
    }
  }

  function writeRulesCache(input) {
    if (typeof window.sessionStorage === "undefined") {
      return;
    }
    try {
      window.sessionStorage.setItem(
        RULES_CACHE_KEY,
        JSON.stringify({
          customerScope: String(loggedInCustomerId || ""),
          fetchedAt: Date.now(),
          configVersion: input.configVersion || null,
          allowRemoveAtMinimumOrderQuantity:
            input.allowRemoveAtMinimumOrderQuantity !== false,
          quantityConstraintsByHandle: input.quantityConstraintsByHandle || {},
          quantityConstraintsByProductId: input.quantityConstraintsByProductId || {},
          hiddenHandles: Array.isArray(input.hiddenHandles) ? input.hiddenHandles : [],
        }),
      );
    } catch {}
  }

  function persistRulesCache(hiddenHandles) {
    const cached = readRulesCache();
    const canReuseCachedHiddenHandles =
      !cached ||
      !cached.configVersion ||
      !state.rulesConfigVersion ||
      cached.configVersion === state.rulesConfigVersion;
    const mergedHiddenHandles = mergeUniqueStringArrays(
      canReuseCachedHiddenHandles &&
        cached &&
        Array.isArray(cached.hiddenHandles)
        ? cached.hiddenHandles
        : [],
      hiddenHandles,
    );
    writeRulesCache({
      configVersion: state.rulesConfigVersion,
      allowRemoveAtMinimumOrderQuantity: state.allowRemoveAtMinimumOrderQuantity,
      quantityConstraintsByHandle: state.quantityConstraintsByHandle,
      quantityConstraintsByProductId: state.quantityConstraintsByProductId,
      hiddenHandles: mergedHiddenHandles,
    });
    return mergedHiddenHandles;
  }

  function hydrateRulesFromCache() {
    const cached = readRulesCache();
    if (!cached) {
      return;
    }
    state.rulesConfigVersion = cached.configVersion;
    state.allowRemoveAtMinimumOrderQuantity =
      cached.allowRemoveAtMinimumOrderQuantity !== false;
    state.quantityConstraintsByHandle = normalizeQuantityRules(
      cached.quantityConstraintsByHandle,
      normalizeHandle,
    );
    state.quantityConstraintsByProductId = normalizeQuantityRules(
      cached.quantityConstraintsByProductId,
      normalizeProductId,
    );
    const hiddenHandles = mergeUniqueStringArrays(cached.hiddenHandles, []);
    for (const handle of hiddenHandles) {
      hideCardForHandle(handle);
      blockCurrentProductPage(handle);
    }
    enforceCurrentProductQuantityRule(state.quantityConstraintsByHandle);
    syncCartQuantityInputs(state.quantityConstraintsByHandle);
  }

  function normalizeQuantityForRule(rawQuantity, rule, options) {
    const allowZero = Boolean(options && options.allowZero);
    const maxQuantity = parseOptionalPositiveInt(options && options.maxQuantity);
    const parsedRaw = Number(rawQuantity);
    if (allowZero && Number.isFinite(parsedRaw) && Math.floor(parsedRaw) <= 0) {
      return 0;
    }
    const parsed = parsePositiveInt(rawQuantity, 1);
    const minApplied = Math.max(parsed, rule.minimumOrderQuantity);
    const applyMax = (value) => {
      if (maxQuantity == null) {
        return value;
      }
      return Math.min(value, maxQuantity);
    };
    if (rule.stepQuantity <= 1) {
      return applyMax(minApplied);
    }
    const remainder = minApplied % rule.stepQuantity;
    if (remainder === 0) {
      return applyMax(minApplied);
    }
    return applyMax(minApplied + (rule.stepQuantity - remainder));
  }

  function isCartAddForm(form) {
    if (!(form instanceof HTMLFormElement)) {
      return false;
    }
    const action = String(form.getAttribute("action") || "");
    return /\\/cart\\/add(?:[/?#]|$)/i.test(action);
  }

  function ensureQuantityInput(form) {
    let quantityInput = form.querySelector("input[name='quantity']");
    if (quantityInput instanceof HTMLInputElement) {
      return quantityInput;
    }

    quantityInput = document.createElement("input");
    quantityInput.setAttribute("type", "hidden");
    quantityInput.setAttribute("name", "quantity");
    quantityInput.value = "1";
    form.append(quantityInput);
    return quantityInput;
  }

  function isQuantityInput(element) {
    const normalizedName =
      element instanceof HTMLInputElement
        ? String(element.name || "").trim().toLowerCase()
        : "";
    return (
      element instanceof HTMLInputElement &&
      (element.type === "number" ||
        normalizedName === "quantity" ||
        normalizedName === "updates[]" ||
        /^updates\\[[^\\]]+\\]$/.test(normalizedName) ||
        element.classList.contains("quantity__input"))
    );
  }

  function isCartQuantityInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }
    const normalizedName = String(input.name || "").trim().toLowerCase();
    if (
      normalizedName === "updates[]" ||
      /^updates\\[[^\\]]+\\]$/.test(normalizedName)
    ) {
      return true;
    }
    const form = input.closest("form");
    if (form instanceof HTMLFormElement) {
      const action = String(form.getAttribute("action") || "");
      if (/\\/cart(?:\\/change|\\/update|\\/clear|$)/i.test(action)) {
        return true;
      }
    }
    return Boolean(
      input.closest(
        "cart-drawer, cart-items, .cart-drawer, .drawer, .cart__items, #CartDrawer",
      ),
    );
  }

  function extractUpdateLineIdentifierFromInput(input) {
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    const normalizedName = String(input.name || "").trim();
    const match = normalizedName.match(/^updates\\[([^\\]]+)\\]$/i);
    if (!match || !match[1]) {
      return null;
    }
    return String(match[1]).trim() || null;
  }

  function resolveProductIdForElement(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const indexedElement =
      element instanceof HTMLInputElement
        ? element
        : element.closest("input[data-index], input[name='updates[]'], input[name^='updates[']");
    if (indexedElement instanceof HTMLInputElement) {
      const dataIndex = parsePositiveInt(indexedElement.getAttribute("data-index"), 0);
      if (dataIndex > 0) {
        const mappedProductId = normalizeProductId(
          state.cartLineProductIdByIndex[dataIndex],
        );
        if (mappedProductId) {
          return mappedProductId;
        }
      }
      const updateLineIdentifier = extractUpdateLineIdentifierFromInput(indexedElement);
      if (updateLineIdentifier) {
        const mappedProductIdByKey = normalizeProductId(
          state.cartLineProductIdByKey[updateLineIdentifier],
        );
        if (mappedProductIdByKey) {
          return mappedProductIdByKey;
        }
        const normalizedVariantId = normalizeVariantId(updateLineIdentifier);
        if (normalizedVariantId) {
          const mappedProductIdByVariant = normalizeProductId(
            state.cartLineProductIdByVariantId[normalizedVariantId],
          );
          if (mappedProductIdByVariant) {
            return mappedProductIdByVariant;
          }
        }
      }
      if (
        String(indexedElement.name || "").trim().toLowerCase() === "updates[]"
      ) {
        const updateInputs = Array.from(
          document.querySelectorAll("input[name='updates[]']"),
        ).filter((input) => input instanceof HTMLInputElement && isQuantityInput(input));
        const position = updateInputs.indexOf(indexedElement);
        if (position >= 0) {
          const mappedProductId = normalizeProductId(
            state.cartLineProductIdByIndex[position + 1],
          );
          if (mappedProductId) {
            return mappedProductId;
          }
        }
      }
    }

    const dataProductHost = element.closest("[data-product-id]");
    if (dataProductHost) {
      const dataProductId = normalizeProductId(
        dataProductHost.getAttribute("data-product-id"),
      );
      if (dataProductId) {
        return dataProductId;
      }
    }

    const parentForm = element.closest("form");
    if (parentForm instanceof HTMLFormElement) {
      const productIdInput = parentForm.querySelector(
        "input[name='product-id'], input[name='product_id']",
      );
      if (productIdInput instanceof HTMLInputElement) {
        const normalizedProductId = normalizeProductId(productIdInput.value);
        if (normalizedProductId) {
          return normalizedProductId;
        }
      }
    }

    if (element.closest("form[action*='/cart/add']")) {
      if (!state.currentProductId) {
        state.currentProductId = resolveCurrentProductIdFromDom();
      }
      const normalizedCurrentProductId = normalizeProductId(state.currentProductId);
      if (normalizedCurrentProductId) {
        return normalizedCurrentProductId;
      }
    }

    return null;
  }

  function resolveQuantityRuleForProductId(productId) {
    const normalizedProductId = normalizeProductId(productId);
    if (!normalizedProductId) {
      return null;
    }
    return state.quantityConstraintsByProductId[normalizedProductId] || null;
  }

  function normalizeCartRequestedQuantity(
    rawRequestedQuantity,
    currentQuantity,
    rule,
    options,
  ) {
    const maxQuantity = parseOptionalPositiveInt(options && options.maxQuantity);
    const allowRemoveAtMinimumOrderQuantity =
      options && typeof options.allowRemoveAtMinimumOrderQuantity === "boolean"
        ? options.allowRemoveAtMinimumOrderQuantity
        : true;
    const requestedQuantity = parseInteger(
      rawRequestedQuantity,
      parsePositiveInt(currentQuantity, 1),
    );
    const current = Math.max(0, parsePositiveInt(currentQuantity, 0));
    const applyMax = (value) => {
      if (maxQuantity == null) {
        return value;
      }
      return Math.min(value, maxQuantity);
    };
    if (requestedQuantity <= 0) {
      if (
        !allowRemoveAtMinimumOrderQuantity &&
        current > 0 &&
        current <= rule.minimumOrderQuantity
      ) {
        return rule.minimumOrderQuantity;
      }
      return 0;
    }
    if (rule.stepQuantity <= 1) {
      if (requestedQuantity < rule.minimumOrderQuantity && current > requestedQuantity) {
        if (
          !allowRemoveAtMinimumOrderQuantity &&
          current > 0 &&
          current <= rule.minimumOrderQuantity
        ) {
          return rule.minimumOrderQuantity;
        }
        return 0;
      }
      return applyMax(Math.max(requestedQuantity, rule.minimumOrderQuantity));
    }

    const isDecreasing = current > 0 && requestedQuantity < current;
    if (isDecreasing) {
      if (requestedQuantity < rule.minimumOrderQuantity && current <= rule.minimumOrderQuantity) {
        if (!allowRemoveAtMinimumOrderQuantity) {
          return rule.minimumOrderQuantity;
        }
        return 0;
      }
      const flooredToStep =
        Math.floor(requestedQuantity / rule.stepQuantity) * rule.stepQuantity;
      if (flooredToStep <= 0) {
        if (
          !allowRemoveAtMinimumOrderQuantity &&
          current > 0 &&
          current <= rule.minimumOrderQuantity
        ) {
          return rule.minimumOrderQuantity;
        }
        return 0;
      }
      return applyMax(Math.max(flooredToStep, rule.minimumOrderQuantity));
    }

    return normalizeQuantityForRule(requestedQuantity, rule, {
      allowZero: false,
      maxQuantity,
    });
  }

  function resolveHandleForElement(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const indexedElement =
      element instanceof HTMLInputElement
        ? element
        : element.closest("input[data-index], input[name='updates[]'], input[name^='updates[']");
    if (indexedElement instanceof HTMLInputElement) {
      const dataIndex = parsePositiveInt(indexedElement.getAttribute("data-index"), 0);
      if (dataIndex > 0) {
        const mappedHandle = normalizeHandle(state.cartLineHandleByIndex[dataIndex]);
        if (mappedHandle) {
          return mappedHandle;
        }
      }
      const updateLineIdentifier = extractUpdateLineIdentifierFromInput(indexedElement);
      if (updateLineIdentifier) {
        const lineIndexByKey = parsePositiveInt(
          state.cartLineIndexByKey[updateLineIdentifier],
          0,
        );
        if (lineIndexByKey > 0) {
          const mappedHandleByKey = normalizeHandle(
            state.cartLineHandleByIndex[lineIndexByKey],
          );
          if (mappedHandleByKey) {
            return mappedHandleByKey;
          }
        }
        const normalizedVariantId = normalizeVariantId(updateLineIdentifier);
        if (normalizedVariantId) {
          const lineIndexByVariant = parsePositiveInt(
            state.cartLineIndexByVariantId[normalizedVariantId],
            0,
          );
          if (lineIndexByVariant > 0) {
            const mappedHandleByVariant = normalizeHandle(
              state.cartLineHandleByIndex[lineIndexByVariant],
            );
            if (mappedHandleByVariant) {
              return mappedHandleByVariant;
            }
          }
        }
      }
      if (String(indexedElement.name || "").trim().toLowerCase() === "updates[]") {
        const updateInputs = Array.from(
          document.querySelectorAll("input[name='updates[]']"),
        ).filter((input) => input instanceof HTMLInputElement && isQuantityInput(input));
        const position = updateInputs.indexOf(indexedElement);
        if (position >= 0) {
          const mappedHandle = normalizeHandle(
            state.cartLineHandleByIndex[position + 1],
          );
          if (mappedHandle) {
            return mappedHandle;
          }
        }
      }
    }

    const dataHandleHost = element.closest("[data-product-handle]");
    if (dataHandleHost) {
      const handle = normalizeHandle(dataHandleHost.getAttribute("data-product-handle"));
      if (handle) {
        return handle;
      }
    }

    const nearestAnchor = element.closest("a[href*='/products/']");
    if (nearestAnchor instanceof HTMLAnchorElement) {
      const handle = extractHandleFromUrl(nearestAnchor.getAttribute("href") || "");
      if (handle) {
        return handle;
      }
    }

    const containers = [
      element.closest("[data-cart-item]"),
      element.closest(".cart-item"),
      element.closest(".cart-drawer__item"),
      element.closest(".drawer__cart-item"),
      element.closest("form"),
      element.closest("li"),
      element.closest("tr"),
    ];
    for (const container of containers) {
      if (!(container instanceof Element)) {
        continue;
      }
      const anchor = container.querySelector("a[href*='/products/']");
      if (!(anchor instanceof HTMLAnchorElement)) {
        continue;
      }
      const handle = extractHandleFromUrl(anchor.getAttribute("href") || "");
      if (handle) {
        return handle;
      }
    }

    if (element.closest("form[action*='/cart/add']")) {
      return extractHandleFromPath(window.location.pathname);
    }

    return null;
  }

  function resolveQuantityRuleForElement(element, quantityConstraintsByHandle) {
    const productId = resolveProductIdForElement(element);
    const productRule = resolveQuantityRuleForProductId(productId);
    if (productRule) {
      return productRule;
    }

    const handle = resolveHandleForElement(element);
    if (!handle) {
      return null;
    }
    return quantityConstraintsByHandle[handle] || null;
  }

  function syncQuantityInputForRule(input, rule, options) {
    const allowZero = Boolean(options && options.allowZero);
    const notifyOnMaxClamp = Boolean(options && options.notifyOnMaxClamp);
    const rawValue = String(input.value || "");
    const stockMax = resolveInputStockMax(input);
    const effectiveMax = resolveEffectiveMaxForRule(rule, stockMax);
    const normalizedQuantity = normalizeQuantityForRule(rawValue, rule, {
      allowZero,
      maxQuantity: effectiveMax,
    });
    if (notifyOnMaxClamp) {
      maybeShowMaximumQuantityAdjustmentNotice(
        rawValue,
        normalizedQuantity,
        effectiveMax,
        resolveProductTitleFromElement(input),
      );
    }
    input.value = String(normalizedQuantity);
    input.setAttribute("min", String(allowZero ? 0 : rule.minimumOrderQuantity));
    if (rule.stepQuantity > 1) {
      input.setAttribute("step", String(rule.stepQuantity));
    } else {
      input.removeAttribute("step");
    }
    if (effectiveMax != null) {
      if (input.dataset.marginGuardOriginalMax == null) {
        const currentMax = input.getAttribute("max");
        input.dataset.marginGuardOriginalMax = currentMax == null ? "" : currentMax;
      }
      input.setAttribute("max", String(effectiveMax));
    } else if (input.dataset.marginGuardOriginalMax != null) {
      const originalMax = String(input.dataset.marginGuardOriginalMax || "");
      if (originalMax) {
        input.setAttribute("max", originalMax);
      } else {
        input.removeAttribute("max");
      }
      delete input.dataset.marginGuardOriginalMax;
    }
    if (effectiveMax != null) {
      input.dataset.marginGuardEffectiveMax = String(effectiveMax);
    } else {
      delete input.dataset.marginGuardEffectiveMax;
    }
  }

  function removeCurrentProductStepNotices() {
    const selectors = [
      "[data-margin-guard-pdp-step='1']",
      "[data-margin-guard-step-notice='1']",
      "[data-margin-guard-pdp-moq='1']",
      "[data-margin-guard-pdp-quantity-notice='1']",
      "[data-margin-guard-step='1']",
      ".margin-guard-pdp-step-notice",
      ".margin-guard-pdp-moq-notice",
      ".margin-guard-pdp-quantity-notice",
      "#margin-guard-pdp-step-notice",
      "#margin-guard-pdp-quantity-notice",
    ];
    for (const node of document.querySelectorAll(selectors.join(","))) {
      if (node instanceof HTMLElement) {
        node.remove();
      }
    }
  }

  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    if (element.getClientRects().length === 0) {
      return false;
    }
    const computed = window.getComputedStyle(element);
    if (computed.display === "none" || computed.visibility === "hidden") {
      return false;
    }
    return true;
  }

  function isDynamicCheckoutButton(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    return Boolean(
      element.closest(
        ".shopify-payment-button, shopify-payment-button, [data-shopify='payment-button'], [data-shopify-payment-button]",
      ),
    );
  }

  function resolveAddToCartButtonForForm(form) {
    if (!(form instanceof HTMLFormElement)) {
      return null;
    }
    const selectors = [
      "button[name='add']",
      "button[type='submit'][name='add']",
      "input[type='submit'][name='add']",
    ];
    let fallbackButton = null;
    for (const selector of selectors) {
      for (const button of form.querySelectorAll(selector)) {
        if (!(button instanceof HTMLElement)) {
          continue;
        }
        if (isDynamicCheckoutButton(button)) {
          continue;
        }
        if (!fallbackButton) {
          fallbackButton = button;
        }
        if (isElementVisible(button)) {
          return button;
        }
      }
    }
    return fallbackButton;
  }

  function resolvePrimaryAddToCartForm() {
    const forms = Array.from(document.querySelectorAll("form[action]")).filter((form) =>
      isCartAddForm(form),
    );
    if (forms.length === 0) {
      return null;
    }

    let fallbackForm = null;
    for (const form of forms) {
      const addButton = resolveAddToCartButtonForForm(form);
      if (!(addButton instanceof HTMLElement)) {
        continue;
      }
      if (isElementVisible(addButton)) {
        return form;
      }
      if (!fallbackForm) {
        fallbackForm = form;
      }
    }
    return fallbackForm || forms[0] || null;
  }

  function resolvePdpNoticeScope() {
    const primaryForm = resolvePrimaryAddToCartForm();
    if (primaryForm instanceof HTMLFormElement) {
      const scopedContainers = [
        primaryForm.closest(".product__info-container"),
        primaryForm.closest(".product__info-wrapper"),
        primaryForm.closest(".product-single__meta"),
        primaryForm.closest("[data-product-info]"),
        primaryForm.closest("product-info"),
        primaryForm.closest("main"),
      ];
      for (const container of scopedContainers) {
        if (container instanceof Element) {
          return container;
        }
      }
    }
    return document.querySelector("main") || document.body;
  }

  function resolvePdpPriceElement(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") {
      return null;
    }
    const selectors = [
      ".price .price-item--regular",
      ".price .price-item--last",
      ".product__price",
      ".product-single__price",
      "[data-product-price]",
      "[data-price]",
      ".price",
    ];
    let fallbackElement = null;
    for (const selector of selectors) {
      for (const element of scope.querySelectorAll(selector)) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }
        if (!fallbackElement) {
          fallbackElement = element;
        }
        if (!isElementVisible(element)) {
          continue;
        }
        const text = String(element.textContent || "").trim();
        if (/\\d/.test(text)) {
          return element;
        }
      }
    }
    return fallbackElement;
  }

  function upsertCurrentProductStepNoticeForPdp(rule) {
    if (
      !rule ||
      (rule.stepQuantity <= 1 && rule.minimumOrderQuantity <= 1)
    ) {
      return;
    }

    const scopedRoot = resolvePdpNoticeScope();
    const priceElement =
      resolvePdpPriceElement(scopedRoot) || resolvePdpPriceElement(document);
    if (!(priceElement instanceof HTMLElement)) {
      return;
    }

    const noticeContainer = document.createElement("div");
    noticeContainer.id = "margin-guard-pdp-quantity-notice";
    noticeContainer.className = "margin-guard-pdp-quantity-notice";
    noticeContainer.setAttribute("data-margin-guard-pdp-quantity-notice", "1");
    noticeContainer.style.margin = "8px 0";

    if (rule.minimumOrderQuantity > 1) {
      const moqNotice = document.createElement("p");
      moqNotice.className = "margin-guard-pdp-moq-notice";
      moqNotice.setAttribute("data-margin-guard-pdp-moq", "1");
      moqNotice.setAttribute("data-margin-guard-step-notice", "1");
      moqNotice.style.margin = "0 0 6px";
      moqNotice.style.fontSize = "13px";
      moqNotice.style.lineHeight = "1.35";
      moqNotice.style.color = "#344054";
      moqNotice.textContent = messageForPdpMinimumOrderQuantity(
        rule.minimumOrderQuantity,
      );
      noticeContainer.appendChild(moqNotice);
    }

    if (rule.stepQuantity > 1) {
      const stepNotice = document.createElement("p");
      stepNotice.id = "margin-guard-pdp-step-notice";
      stepNotice.className = "margin-guard-pdp-step-notice";
      stepNotice.setAttribute("data-margin-guard-pdp-step", "1");
      stepNotice.setAttribute("data-margin-guard-step-notice", "1");
      stepNotice.style.margin = "0";
      stepNotice.style.fontSize = "13px";
      stepNotice.style.lineHeight = "1.35";
      stepNotice.style.color = "#344054";
      stepNotice.textContent = messageForPdpStepQuantity(rule.stepQuantity);
      noticeContainer.appendChild(stepNotice);
    }

    if (!noticeContainer.childElementCount) {
      return;
    }

    if (priceElement.parentElement) {
      priceElement.parentElement.insertBefore(noticeContainer, priceElement);
      return;
    }
    const fallbackParent = resolvePrimaryAddToCartForm();
    if (fallbackParent instanceof HTMLElement) {
      fallbackParent.prepend(noticeContainer);
    }
  }

  function syncCurrentProductStepNotices(rule) {
    const currentHandle = extractHandleFromPath(window.location.pathname);
    if (!currentHandle) {
      removeCurrentProductStepNotices();
      return;
    }
    removeCurrentProductStepNotices();
    if (
      !rule ||
      (rule.stepQuantity <= 1 && rule.minimumOrderQuantity <= 1)
    ) {
      return;
    }
    upsertCurrentProductStepNoticeForPdp(rule);
  }

  function syncCartQuantityInputs(quantityConstraintsByHandle) {
    for (const element of document.querySelectorAll("input")) {
      if (!isQuantityInput(element)) {
        continue;
      }
      if (!isCartQuantityInput(element)) {
        continue;
      }
      const rule = resolveQuantityRuleForElement(element, quantityConstraintsByHandle);
      if (!rule) {
        continue;
      }
      syncQuantityInputForRule(element, rule, { allowZero: true });
    }
  }

  function syncCurrentProductAddToCartForms(rule) {
    for (const form of document.querySelectorAll("form[action]")) {
      if (!isCartAddForm(form)) {
        continue;
      }
      const quantityInput = ensureQuantityInput(form);
      syncQuantityInputForRule(quantityInput, rule, { allowZero: false });
    }
  }

  function bindSubmitQuantityNormalization(rule) {
    const key = "marginGuardQuantitySubmitBound";
    if (document.documentElement.dataset[key] === "1") {
      return;
    }
    document.documentElement.dataset[key] = "1";
    document.addEventListener(
      "submit",
      (event) => {
        const target = event.target;
        if (!isCartAddForm(target)) {
          return;
        }
        const quantityInput = ensureQuantityInput(target);
        syncQuantityInputForRule(quantityInput, rule, { allowZero: false });
      },
      true,
    );
  }

  function enforceCurrentProductQuantityRule(quantityConstraintsByHandle) {
    const currentHandle = extractHandleFromPath(window.location.pathname);
    if (!currentHandle) {
      syncCurrentProductStepNotices(null);
      return;
    }
    if (
      !quantityConstraintsByHandle ||
      typeof quantityConstraintsByHandle !== "object"
    ) {
      syncCurrentProductStepNotices(null);
      return;
    }
    const normalizedRule = normalizeQuantityRule(
      quantityConstraintsByHandle[currentHandle],
    );
    if (!normalizedRule) {
      syncCurrentProductStepNotices(null);
      return;
    }
    syncCurrentProductAddToCartForms(normalizedRule);
    bindSubmitQuantityNormalization(normalizedRule);
    syncCurrentProductStepNotices(normalizedRule);
  }

  function detectQuantityButtonDirection(button) {
    if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) {
      return 0;
    }
    const name = String(button.getAttribute("name") || "").toLowerCase();
    const label = String(button.getAttribute("aria-label") || "").toLowerCase();
    const classes = String(button.className || "").toLowerCase();
    const text =
      button instanceof HTMLButtonElement
        ? String(button.textContent || "").trim()
        : "";
    const signal = [name, label, classes, text].join(" ");
    if (
      text === "+" ||
      /\\bplus\\b|\\bincrement\\b|\\bincrease\\b/.test(signal)
    ) {
      return 1;
    }
    if (
      text === "-" ||
      /\\bminus\\b|\\bdecrement\\b|\\bdecrease\\b/.test(signal)
    ) {
      return -1;
    }
    return 0;
  }

  function findQuantityInputForButton(button) {
    if (!(button instanceof Element)) {
      return null;
    }
    const localContainer = button.closest(
      ".quantity, [data-quantity], [data-quantity-selector], .cart-item, .cart-drawer__item, .drawer__cart-item",
    );
    if (localContainer instanceof Element) {
      for (const localInput of localContainer.querySelectorAll("input")) {
        if (isQuantityInput(localInput)) {
          return localInput;
        }
      }
    }

    const form = button.closest("form");
    if (form instanceof HTMLFormElement) {
      for (const formInput of form.querySelectorAll("input")) {
        if (isQuantityInput(formInput)) {
          return formInput;
        }
      }
    }

    return null;
  }

  function adjustQuantityInputBeforeClick(input, rule, direction) {
    if (direction === 0) {
      return {
        maxBlocked: false,
      };
    }
    const currentValue = Math.max(0, parseInteger(input.value, 0));
    const effectiveMax = resolveEffectiveMaxForInput(input, rule);
    if (
      direction > 0 &&
      effectiveMax != null &&
      currentValue >= effectiveMax
    ) {
      input.value = String(effectiveMax);
      showCartQuantityNotice(
        messageForCartMaximumQuantity(
          effectiveMax,
          resolveProductTitleFromElement(input),
        ),
      );
      return {
        maxBlocked: true,
      };
    }
    const requestedQuantity =
      direction > 0 ? currentValue + 1 : Math.max(0, currentValue - 1);
    const normalizedQuantity =
      direction > 0
        ? normalizeQuantityForRule(requestedQuantity, rule, {
            allowZero: false,
            maxQuantity: effectiveMax,
          })
        : normalizeCartRequestedQuantity(
            requestedQuantity,
            currentValue,
            rule,
            {
              maxQuantity: effectiveMax,
              allowRemoveAtMinimumOrderQuantity:
                state.allowRemoveAtMinimumOrderQuantity !== false,
            },
          );
    maybeShowMaximumQuantityAdjustmentNotice(
      requestedQuantity,
      normalizedQuantity,
      effectiveMax,
      resolveProductTitleFromElement(input),
    );
    maybeShowMoqRemovalBlockedNotice(
      requestedQuantity,
      normalizedQuantity,
      currentValue,
      rule.minimumOrderQuantity,
    );
    if (normalizedQuantity === currentValue) {
      return {
        maxBlocked: false,
      };
    }
    const preAdjustedValue =
      direction > 0 ? Math.max(0, normalizedQuantity - 1) : normalizedQuantity + 1;
    input.value = String(preAdjustedValue);
    return {
      maxBlocked: false,
    };
  }

  function resolveRuleForAddRequest(productId) {
    const productRule = resolveQuantityRuleForProductId(productId);
    if (productRule) {
      return productRule;
    }
    const currentHandle = extractHandleFromPath(window.location.pathname);
    if (!currentHandle) {
      return null;
    }
    return state.quantityConstraintsByHandle[currentHandle] || null;
  }

  function resolveCurrentCartQuantityForProduct(productId) {
    const normalizedProductId = normalizeProductId(productId);
    if (!normalizedProductId) {
      return 0;
    }
    let totalQuantity = 0;
    const productIdByIndex = state.cartLineProductIdByIndex || {};
    const quantityByIndex = state.cartLineQuantityByIndex || {};
    for (const [rawLineIndex, mappedProductId] of Object.entries(productIdByIndex)) {
      if (normalizeProductId(mappedProductId) !== normalizedProductId) {
        continue;
      }
      const lineIndex = parsePositiveInt(rawLineIndex, 0);
      if (lineIndex < 1) {
        continue;
      }
      const lineQuantity = Math.max(0, parseInteger(quantityByIndex[lineIndex], 0));
      totalQuantity += lineQuantity;
    }
    return totalQuantity;
  }

  function normalizeAddRequestedQuantity(
    rawRequestedQuantity,
    currentProductQuantity,
    rule,
    options,
  ) {
    const maxQuantity = parseOptionalPositiveInt(options && options.maxQuantity);
    const baseRequestedQuantity = parsePositiveInt(rawRequestedQuantity, 1);
    if (currentProductQuantity <= 0) {
      return normalizeQuantityForRule(baseRequestedQuantity, rule, {
        allowZero: false,
        maxQuantity,
      });
    }

    // PDP forms are usually prefilled with the first valid quantity (MOQ/step).
    // Once the product is already in cart, a plain add-to-cart click should mean one step up.
    const initialValidAddQuantity = normalizeQuantityForRule(1, rule, {
      allowZero: false,
      maxQuantity: null,
    });
    const requestedDelta =
      baseRequestedQuantity === initialValidAddQuantity ? 1 : baseRequestedQuantity;
    const normalizedTargetTotal = normalizeQuantityForRule(
      currentProductQuantity + requestedDelta,
      rule,
      {
        allowZero: false,
        maxQuantity,
      },
    );
    const normalizedDelta = normalizedTargetTotal - currentProductQuantity;
    if (normalizedDelta > 0) {
      return normalizedDelta;
    }
    return normalizeQuantityForRule(baseRequestedQuantity, rule, {
      allowZero: false,
      maxQuantity,
    });
  }

  function resolveQuantityInputForAddRequest(productId) {
    const normalizedProductId = normalizeProductId(productId);
    for (const form of document.querySelectorAll("form[action]")) {
      if (!isCartAddForm(form)) {
        continue;
      }
      if (normalizedProductId) {
        const productIdInput = form.querySelector(
          "input[name='product-id'], input[name='product_id']",
        );
        if (productIdInput instanceof HTMLInputElement) {
          const formProductId = normalizeProductId(productIdInput.value);
          if (formProductId && formProductId !== normalizedProductId) {
            continue;
          }
        }
      }
      return ensureQuantityInput(form);
    }
    return null;
  }

  function resolveRuleForCartLineIndex(lineIndex) {
    const normalizedLineIndex = parsePositiveInt(lineIndex, 0);
    if (normalizedLineIndex < 1) {
      return null;
    }
    const productRule = resolveQuantityRuleForProductId(
      state.cartLineProductIdByIndex[normalizedLineIndex],
    );
    if (productRule) {
      return productRule;
    }
    const mappedHandle = normalizeHandle(state.cartLineHandleByIndex[normalizedLineIndex]);
    if (!mappedHandle) {
      return null;
    }
    return state.quantityConstraintsByHandle[mappedHandle] || null;
  }

  function resolveCartQuantityInputByLineIndex(lineIndex) {
    const normalizedLineIndex = parsePositiveInt(lineIndex, 0);
    if (normalizedLineIndex < 1) {
      return null;
    }
    const indexedInput = document.querySelector(
      "input[data-index='" + normalizedLineIndex + "']",
    );
    if (indexedInput instanceof HTMLInputElement && isQuantityInput(indexedInput)) {
      return indexedInput;
    }
    const updateInputs = Array.from(
      document.querySelectorAll("input[name='updates[]']"),
    ).filter((input) => input instanceof HTMLInputElement && isQuantityInput(input));
    return updateInputs[normalizedLineIndex - 1] || null;
  }

  function resolveCartQuantityInputByLineIdentifier(lineIdentifier) {
    const normalizedIdentifier = normalizeLineKey(lineIdentifier);
    if (!normalizedIdentifier) {
      return null;
    }
    const expectedFieldName = "updates[" + normalizedIdentifier + "]";
    for (const input of document.querySelectorAll("input[name^='updates[']")) {
      if (!(input instanceof HTMLInputElement) || !isQuantityInput(input)) {
        continue;
      }
      if (String(input.name || "").trim() === expectedFieldName) {
        return input;
      }
    }
    const lineIndex = parsePositiveInt(state.cartLineIndexByKey[normalizedIdentifier], 0);
    if (lineIndex > 0) {
      return resolveCartQuantityInputByLineIndex(lineIndex);
    }
    const normalizedVariantId = normalizeVariantId(normalizedIdentifier);
    if (normalizedVariantId) {
      const lineIndexByVariant = parsePositiveInt(
        state.cartLineIndexByVariantId[normalizedVariantId],
        0,
      );
      if (lineIndexByVariant > 0) {
        return resolveCartQuantityInputByLineIndex(lineIndexByVariant);
      }
    }
    return null;
  }

  function resolveCartQuantityInputForContext(context) {
    if (!context || typeof context !== "object") {
      return null;
    }
    if (context.lineIndex > 0) {
      const indexedInput = resolveCartQuantityInputByLineIndex(context.lineIndex);
      if (indexedInput) {
        return indexedInput;
      }
    }
    if (context.lineKey) {
      const keyedInput = resolveCartQuantityInputByLineIdentifier(context.lineKey);
      if (keyedInput) {
        return keyedInput;
      }
    }
    if (context.variantId) {
      const variantInput = resolveCartQuantityInputByLineIdentifier(context.variantId);
      if (variantInput) {
        return variantInput;
      }
    }
    return null;
  }

  function resolveProductTitleForProductId(productId) {
    const normalizedProductId = normalizeProductId(productId);
    if (!normalizedProductId) {
      return null;
    }
    for (const [rawLineIndex, mappedProductId] of Object.entries(
      state.cartLineProductIdByIndex || {},
    )) {
      if (normalizeProductId(mappedProductId) !== normalizedProductId) {
        continue;
      }
      const lineIndex = parsePositiveInt(rawLineIndex, 0);
      if (lineIndex < 1) {
        continue;
      }
      const input = resolveCartQuantityInputByLineIndex(lineIndex);
      const title = resolveProductTitleFromElement(input);
      if (title) {
        return title;
      }
    }
    if (normalizedProductId === normalizeProductId(state.currentProductId)) {
      const currentTitle = resolveCurrentProductTitleFromDom();
      if (currentTitle) {
        return currentTitle;
      }
    }
    return null;
  }

  function resolveProductTitleForCartContext(context) {
    if (!context || typeof context !== "object") {
      return null;
    }
    const input = resolveCartQuantityInputForContext(context);
    const titleFromInput = resolveProductTitleFromElement(input);
    if (titleFromInput) {
      return titleFromInput;
    }
    const titleFromProductId = resolveProductTitleForProductId(context.productId);
    if (titleFromProductId) {
      return titleFromProductId;
    }
    return null;
  }

  function resolveEffectiveMaxForCartContext(context) {
    const input = resolveCartQuantityInputForContext(context);
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    return resolveEffectiveMaxForInput(input, context.rule);
  }

  function applyNormalizedCartLineQuantity(context, normalizedQuantity) {
    const nextQuantity = Math.max(0, parseInteger(normalizedQuantity, 0));
    if (context.lineIndex > 0) {
      state.cartLineQuantityByIndex[context.lineIndex] = nextQuantity;
    }
    if (context.lineKey) {
      state.cartLineQuantityByKey[context.lineKey] = nextQuantity;
    }
    if (context.variantId) {
      state.cartLineQuantityByVariantId[context.variantId] = nextQuantity;
    }
  }

  function resolveCartLineRuleContextByIndex(lineIndex) {
    const normalizedLineIndex = parsePositiveInt(lineIndex, 0);
    if (normalizedLineIndex < 1) {
      return null;
    }
    const rule = resolveRuleForCartLineIndex(normalizedLineIndex);
    if (!rule) {
      return null;
    }
    return {
      rule,
      currentQuantity: state.cartLineQuantityByIndex[normalizedLineIndex],
      lineIndex: normalizedLineIndex,
      lineKey: normalizeLineKey(state.cartLineKeyByIndex[normalizedLineIndex]),
      variantId: normalizeVariantId(state.cartLineVariantIdByIndex[normalizedLineIndex]),
      productId: normalizeProductId(state.cartLineProductIdByIndex[normalizedLineIndex]),
    };
  }

  function resolveCartLineRuleContextByLineIdentifier(rawLineIdentifier) {
    const lineIdentifier = normalizeLineKey(rawLineIdentifier);
    if (!lineIdentifier) {
      return null;
    }
    const lineIndexByKey = parsePositiveInt(state.cartLineIndexByKey[lineIdentifier], 0);
    if (lineIndexByKey > 0) {
      return resolveCartLineRuleContextByIndex(lineIndexByKey);
    }
    const productIdByKey = normalizeProductId(state.cartLineProductIdByKey[lineIdentifier]);
    if (productIdByKey) {
      const ruleByKey = resolveQuantityRuleForProductId(productIdByKey);
      if (ruleByKey) {
        return {
          rule: ruleByKey,
          currentQuantity: state.cartLineQuantityByKey[lineIdentifier],
          lineIndex: 0,
          lineKey: lineIdentifier,
          variantId: null,
          productId: productIdByKey,
        };
      }
    }
    const normalizedVariantId = normalizeVariantId(lineIdentifier);
    if (!normalizedVariantId) {
      if (/^\\d+$/.test(lineIdentifier)) {
        return resolveCartLineRuleContextByIndex(lineIdentifier);
      }
      return null;
    }
    const lineIndexByVariant = parsePositiveInt(
      state.cartLineIndexByVariantId[normalizedVariantId],
      0,
    );
    if (lineIndexByVariant > 0) {
      return resolveCartLineRuleContextByIndex(lineIndexByVariant);
    }
    const productIdByVariant = normalizeProductId(
      state.cartLineProductIdByVariantId[normalizedVariantId],
    );
    if (!productIdByVariant) {
      if (/^\\d+$/.test(lineIdentifier)) {
        return resolveCartLineRuleContextByIndex(lineIdentifier);
      }
      return null;
    }
    const ruleByVariant = resolveQuantityRuleForProductId(productIdByVariant);
    if (!ruleByVariant) {
      return null;
    }
    return {
      rule: ruleByVariant,
      currentQuantity: state.cartLineQuantityByVariantId[normalizedVariantId],
      lineIndex: 0,
      lineKey: null,
      variantId: normalizedVariantId,
      productId: productIdByVariant,
    };
  }

  function resolveCartLineRuleContextForChangeRequest(getValue) {
    const lineIndex = parsePositiveInt(getValue("line"), 0);
    if (lineIndex > 0) {
      return resolveCartLineRuleContextByIndex(lineIndex);
    }
    return resolveCartLineRuleContextByLineIdentifier(getValue("id"));
  }

  function normalizeUpdateValuesByLineIndexes(rawRequestedValues) {
    if (!Array.isArray(rawRequestedValues) || rawRequestedValues.length === 0) {
      return {
        changed: false,
        normalizedValues: [],
      };
    }
    let changed = false;
    const normalizedValues = rawRequestedValues.map((rawRequestedQuantity, index) => {
      const context = resolveCartLineRuleContextByIndex(index + 1);
      if (!context) {
        return String(rawRequestedQuantity);
      }
      const maxQuantity = resolveEffectiveMaxForCartContext(context);
      const normalizedQuantity = normalizeCartRequestedQuantity(
        rawRequestedQuantity,
        context.currentQuantity,
        context.rule,
        {
          maxQuantity,
          allowRemoveAtMinimumOrderQuantity:
            state.allowRemoveAtMinimumOrderQuantity !== false,
        },
      );
      maybeShowMaximumQuantityAdjustmentNotice(
        rawRequestedQuantity,
        normalizedQuantity,
        maxQuantity,
        resolveProductTitleForCartContext(context),
      );
      maybeShowMoqRemovalBlockedNotice(
        rawRequestedQuantity,
        normalizedQuantity,
        context.currentQuantity,
        context.rule.minimumOrderQuantity,
      );
      if (String(rawRequestedQuantity) !== String(normalizedQuantity)) {
        changed = true;
      }
      applyNormalizedCartLineQuantity(context, normalizedQuantity);
      return String(normalizedQuantity);
    });
    return {
      changed,
      normalizedValues,
    };
  }

  function normalizeUpdateEntriesByLineIdentifiers(rawEntries) {
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      return {
        changed: false,
        normalizedEntries: [],
      };
    }
    let changed = false;
    const normalizedEntries = rawEntries.map((entry) => {
      const context = resolveCartLineRuleContextByLineIdentifier(entry.lineIdentifier);
      if (!context) {
        return {
          fieldKey: entry.fieldKey,
          lineIdentifier: entry.lineIdentifier,
          quantity: String(entry.quantity),
        };
      }
      const maxQuantity = resolveEffectiveMaxForCartContext(context);
      const normalizedQuantity = normalizeCartRequestedQuantity(
        entry.quantity,
        context.currentQuantity,
        context.rule,
        {
          maxQuantity,
          allowRemoveAtMinimumOrderQuantity:
            state.allowRemoveAtMinimumOrderQuantity !== false,
        },
      );
      maybeShowMaximumQuantityAdjustmentNotice(
        entry.quantity,
        normalizedQuantity,
        maxQuantity,
        resolveProductTitleForCartContext(context),
      );
      maybeShowMoqRemovalBlockedNotice(
        entry.quantity,
        normalizedQuantity,
        context.currentQuantity,
        context.rule.minimumOrderQuantity,
      );
      if (String(entry.quantity) !== String(normalizedQuantity)) {
        changed = true;
      }
      applyNormalizedCartLineQuantity(context, normalizedQuantity);
      return {
        fieldKey: entry.fieldKey,
        lineIdentifier: entry.lineIdentifier,
        quantity: String(normalizedQuantity),
      };
    });
    return {
      changed,
      normalizedEntries,
    };
  }

  function resolveCartRequestKind(pathname) {
    const normalizedPath = String(pathname || "").toLowerCase();
    if (/\\/cart\\/add(?:\\.js)?$/.test(normalizedPath)) {
      return "add";
    }
    if (/\\/cart\\/change(?:\\.js)?$/.test(normalizedPath)) {
      return "change";
    }
    if (/\\/cart\\/update(?:\\.js)?$/.test(normalizedPath)) {
      return "update";
    }
    return null;
  }

  function resolvePathnameFromUrl(urlLike) {
    try {
      return new URL(String(urlLike || ""), window.location.origin).pathname;
    } catch {
      return "";
    }
  }

  async function refreshCartLineStateFromSnapshot() {
    const now = Date.now();
    if (
      now - lastCartSnapshotRefreshAt < MIN_CART_SNAPSHOT_REFRESH_INTERVAL_MS &&
      Object.keys(state.cartLineQuantityByIndex || {}).length > 0
    ) {
      return;
    }
    if (cartSnapshotRefreshPromise) {
      await cartSnapshotRefreshPromise;
      return;
    }
    cartSnapshotRefreshPromise = (async () => {
      try {
        const cart = await fetchCartSnapshot();
        const cartContext = buildCartLineIndex(cart);
        applyCartLineContext(cartContext);
        lastCartSnapshotRefreshAt = Date.now();
      } catch {}
    })();
    try {
      await cartSnapshotRefreshPromise;
    } finally {
      cartSnapshotRefreshPromise = null;
    }
  }

  function normalizeAddRequestFields(getValue, setValue) {
    const productId =
      normalizeProductId(getValue("product-id")) ||
      normalizeProductId(getValue("product_id")) ||
      normalizeProductId(state.currentProductId) ||
      normalizeProductId(resolveCurrentProductIdFromDom());
    const rule = resolveRuleForAddRequest(productId);
    if (!rule) {
      return false;
    }
    const addQuantityInput = resolveQuantityInputForAddRequest(productId);
    const maxQuantity = addQuantityInput
      ? resolveEffectiveMaxForInput(addQuantityInput, rule)
      : null;
    const currentProductQuantity = resolveCurrentCartQuantityForProduct(productId);
    const requestedQuantityRaw = getValue("quantity") || "1";
    const normalizedQuantity = normalizeAddRequestedQuantity(
      requestedQuantityRaw,
      currentProductQuantity,
      rule,
      { maxQuantity },
    );
    maybeShowMaximumQuantityAdjustmentNotice(
      requestedQuantityRaw,
      normalizedQuantity,
      maxQuantity,
      resolveProductTitleFromElement(addQuantityInput) ||
        resolveProductTitleForProductId(productId) ||
        resolveCurrentProductTitleFromDom(),
    );
    setValue("quantity", String(normalizedQuantity));
    if (addQuantityInput) {
      addQuantityInput.value = String(normalizedQuantity);
    }
    return true;
  }

  function normalizeChangeRequestFields(getValue, setValue) {
    const requestedQuantityRaw = getValue("quantity");
    if (requestedQuantityRaw == null) {
      return false;
    }
    const context = resolveCartLineRuleContextForChangeRequest(getValue);
    if (!context) {
      return false;
    }
    const maxQuantity = resolveEffectiveMaxForCartContext(context);
    const normalizedQuantity = normalizeCartRequestedQuantity(
      requestedQuantityRaw,
      context.currentQuantity,
      context.rule,
      {
        maxQuantity,
        allowRemoveAtMinimumOrderQuantity:
          state.allowRemoveAtMinimumOrderQuantity !== false,
      },
    );
    maybeShowMaximumQuantityAdjustmentNotice(
      requestedQuantityRaw,
      normalizedQuantity,
      maxQuantity,
      resolveProductTitleForCartContext(context),
    );
    maybeShowMoqRemovalBlockedNotice(
      requestedQuantityRaw,
      normalizedQuantity,
      context.currentQuantity,
      context.rule.minimumOrderQuantity,
    );
    setValue("quantity", String(normalizedQuantity));
    applyNormalizedCartLineQuantity(context, normalizedQuantity);
    return true;
  }

  function normalizeUpdateRequestFieldsByIndexes(rawValues, setValues) {
    const normalized = normalizeUpdateValuesByLineIndexes(rawValues);
    if (!normalized.changed) {
      return false;
    }
    setValues(normalized.normalizedValues);
    return true;
  }

  function normalizeUpdateRequestFieldsByLineIdentifiers(rawEntries, setEntries) {
    const normalized = normalizeUpdateEntriesByLineIdentifiers(rawEntries);
    if (!normalized.changed) {
      return false;
    }
    setEntries(normalized.normalizedEntries);
    return true;
  }

  function collectBracketStyleUpdateEntries(rawEntriesIterable) {
    const entries = [];
    for (const [fieldKey, rawValue] of rawEntriesIterable) {
      const normalizedFieldKey = String(fieldKey || "");
      const match = normalizedFieldKey.match(/^updates\\[([^\\]]+)\\]$/i);
      if (!match || !match[1]) {
        continue;
      }
      entries.push({
        fieldKey: normalizedFieldKey,
        lineIdentifier: String(match[1]).trim(),
        quantity: String(rawValue ?? ""),
      });
    }
    return entries;
  }

  function normalizeUpdateRequestObjectValues(rawUpdates) {
    if (!rawUpdates || typeof rawUpdates !== "object") {
      return false;
    }
    let changed = false;
    for (const [updateKey, rawRequestedQuantity] of Object.entries(rawUpdates)) {
      let context = resolveCartLineRuleContextByLineIdentifier(updateKey);
      if (!context && /^\\d+$/.test(String(updateKey || ""))) {
        context = resolveCartLineRuleContextByIndex(updateKey);
      }
      if (!context) {
        continue;
      }
      const maxQuantity = resolveEffectiveMaxForCartContext(context);
      const normalizedQuantity = normalizeCartRequestedQuantity(
        rawRequestedQuantity,
        context.currentQuantity,
        context.rule,
        {
          maxQuantity,
          allowRemoveAtMinimumOrderQuantity:
            state.allowRemoveAtMinimumOrderQuantity !== false,
        },
      );
      maybeShowMaximumQuantityAdjustmentNotice(
        rawRequestedQuantity,
        normalizedQuantity,
        maxQuantity,
        resolveProductTitleForCartContext(context),
      );
      maybeShowMoqRemovalBlockedNotice(
        rawRequestedQuantity,
        normalizedQuantity,
        context.currentQuantity,
        context.rule.minimumOrderQuantity,
      );
      if (String(rawRequestedQuantity) !== String(normalizedQuantity)) {
        changed = true;
      }
      rawUpdates[updateKey] = String(normalizedQuantity);
      applyNormalizedCartLineQuantity(context, normalizedQuantity);
    }
    return changed;
  }

  async function normalizeCartRequestBodyForKind(kind, body, contentType) {
    if (kind === "add" || kind === "change" || kind === "update") {
      await refreshCartLineStateFromSnapshot();
    }

    if (body instanceof FormData) {
      if (kind === "add") {
        const changed = normalizeAddRequestFields(
          (key) => {
            const value = body.get(key);
            return value == null ? "" : String(value);
          },
          (key, value) => body.set(key, value),
        );
        return { body, changed };
      }
      if (kind === "change") {
        const changed = normalizeChangeRequestFields(
          (key) => {
            const value = body.get(key);
            return value == null ? "" : String(value);
          },
          (key, value) => body.set(key, value),
        );
        return { body, changed };
      }
      if (kind === "update") {
        const indexedUpdates = body.getAll("updates[]").map((value) => String(value));
        let changed = false;
        if (indexedUpdates.length > 0) {
          changed = normalizeUpdateRequestFieldsByIndexes(
            indexedUpdates,
            (values) => {
              body.delete("updates[]");
              for (const value of values) {
                body.append("updates[]", value);
              }
            },
          );
        } else {
          const namedUpdates = collectBracketStyleUpdateEntries(body.entries());
          changed = normalizeUpdateRequestFieldsByLineIdentifiers(
            namedUpdates,
            (entries) => {
              for (const entry of entries) {
                body.set(entry.fieldKey, entry.quantity);
              }
            },
          );
        }
        return { body, changed };
      }
      return { body, changed: false };
    }

    if (body instanceof URLSearchParams) {
      if (kind === "add") {
        const changed = normalizeAddRequestFields(
          (key) => body.get(key) || "",
          (key, value) => body.set(key, value),
        );
        return { body, changed };
      }
      if (kind === "change") {
        const changed = normalizeChangeRequestFields(
          (key) => body.get(key) || "",
          (key, value) => body.set(key, value),
        );
        return { body, changed };
      }
      if (kind === "update") {
        const indexedUpdates = body.getAll("updates[]");
        let changed = false;
        if (indexedUpdates.length > 0) {
          changed = normalizeUpdateRequestFieldsByIndexes(
            indexedUpdates,
            (values) => {
              body.delete("updates[]");
              for (const value of values) {
                body.append("updates[]", value);
              }
            },
          );
        } else {
          const namedUpdates = collectBracketStyleUpdateEntries(body.entries());
          changed = normalizeUpdateRequestFieldsByLineIdentifiers(
            namedUpdates,
            (entries) => {
              for (const entry of entries) {
                body.set(entry.fieldKey, entry.quantity);
              }
            },
          );
        }
        return { body, changed };
      }
      return { body, changed: false };
    }

    if (typeof body === "string") {
      const normalizedContentType = String(contentType || "").toLowerCase();
      if (normalizedContentType.includes("application/json")) {
        try {
          const payload = JSON.parse(body);
          if (kind === "add" && payload && typeof payload === "object") {
            const changed = normalizeAddRequestFields(
              (key) => payload[key],
              (key, value) => {
                payload[key] = value;
              },
            );
            return { body: changed ? JSON.stringify(payload) : body, changed };
          }
          if (kind === "change" && payload && typeof payload === "object") {
            const changed = normalizeChangeRequestFields(
              (key) => payload[key],
              (key, value) => {
                payload[key] = value;
              },
            );
            return { body: changed ? JSON.stringify(payload) : body, changed };
          }
          if (
            kind === "update" &&
            payload &&
            typeof payload === "object"
          ) {
            let changed = false;
            if (Array.isArray(payload.updates)) {
              changed = normalizeUpdateRequestFieldsByIndexes(
                payload.updates,
                (values) => {
                  payload.updates = values;
                },
              );
            } else if (payload.updates && typeof payload.updates === "object") {
              changed = normalizeUpdateRequestObjectValues(payload.updates);
            }
            return { body: changed ? JSON.stringify(payload) : body, changed };
          }
        } catch {}
        return { body, changed: false };
      }

      const params = new URLSearchParams(body);
      if (kind === "add") {
        const changed = normalizeAddRequestFields(
          (key) => params.get(key) || "",
          (key, value) => params.set(key, value),
        );
        return { body: changed ? params.toString() : body, changed };
      }
      if (kind === "change") {
        const changed = normalizeChangeRequestFields(
          (key) => params.get(key) || "",
          (key, value) => params.set(key, value),
        );
        return { body: changed ? params.toString() : body, changed };
      }
      if (kind === "update") {
        const indexedUpdates = params.getAll("updates[]");
        let changed = false;
        if (indexedUpdates.length > 0) {
          changed = normalizeUpdateRequestFieldsByIndexes(
            indexedUpdates,
            (values) => {
              params.delete("updates[]");
              for (const value of values) {
                params.append("updates[]", value);
              }
            },
          );
        } else {
          const namedUpdates = collectBracketStyleUpdateEntries(params.entries());
          changed = normalizeUpdateRequestFieldsByLineIdentifiers(
            namedUpdates,
            (entries) => {
              for (const entry of entries) {
                params.set(entry.fieldKey, entry.quantity);
              }
            },
          );
        }
        return { body: changed ? params.toString() : body, changed };
      }
    }

    return { body, changed: false };
  }

  function runWhenDomReady() {
    if (document.readyState !== "loading") {
      return run();
    }
    return new Promise((resolve, reject) => {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          run().then(resolve).catch(reject);
        },
        { once: true },
      );
    });
  }

  function startInitialRulesBootstrap() {
    if (!initialRulesBootstrapPromise) {
      initialRulesBootstrapPromise = runWhenDomReady()
        .catch(() => {})
        .finally(() => {
          initialRulesBootstrapCompleted = true;
        });
    }
    return initialRulesBootstrapPromise;
  }

  async function ensureRulesReady(maxWaitMs) {
    if (initialRulesBootstrapCompleted) {
      return;
    }
    const bootstrapPromise = startInitialRulesBootstrap();
    const waitMs = parsePositiveInt(maxWaitMs, 0);
    if (waitMs < 1) {
      await bootstrapPromise;
      return;
    }
    let timeoutId = null;
    try {
      await Promise.race([
        bootstrapPromise,
        new Promise((resolve) => {
          timeoutId = window.setTimeout(resolve, waitMs);
        }),
      ]);
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }
  }

  function bindCartRequestNormalization() {
    const key = "marginGuardCartRequestNormalizationBound";
    if (document.documentElement.dataset[key] === "1") {
      return;
    }
    document.documentElement.dataset[key] = "1";
    if (typeof window.fetch !== "function") {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      try {
        const requestUrl =
          typeof input === "string" || input instanceof URL
            ? String(input)
            : input && typeof input.url === "string"
              ? input.url
              : "";
        const pathname = resolvePathnameFromUrl(requestUrl);
        const kind = resolveCartRequestKind(pathname);
        if (!kind) {
          return originalFetch(input, init);
        }
        const method = String(
          (init && init.method) ||
            (input instanceof Request ? input.method : "GET"),
        ).toUpperCase();
        if (method !== "POST") {
          return originalFetch(input, init);
        }

        await ensureRulesReady(MAX_RULES_READY_WAIT_MS);

        const targetInit = init ? { ...init } : {};
        let body = targetInit.body;
        let bodyWasReadFromRequest = false;
        if (body == null && input instanceof Request) {
          const requestContentType = String(
            input.headers.get("content-type") || "",
          ).toLowerCase();
          if (requestContentType.includes("multipart/form-data")) {
            try {
              body = await input.clone().formData();
              bodyWasReadFromRequest = true;
            } catch {}
          }
          if (
            body == null &&
            (
              requestContentType.includes("application/json") ||
              requestContentType.includes("application/x-www-form-urlencoded") ||
              requestContentType.includes("text/plain")
            )
          ) {
            body = await input.clone().text();
            bodyWasReadFromRequest = true;
          }
        }
        if (body == null) {
          return originalFetch(input, init);
        }

        let contentType = "";
        if (targetInit.headers instanceof Headers) {
          contentType = targetInit.headers.get("content-type") || "";
        } else if (targetInit.headers && typeof targetInit.headers === "object") {
          contentType =
            targetInit.headers["content-type"] ||
            targetInit.headers["Content-Type"] ||
            "";
        }
        if (!contentType && input instanceof Request) {
          contentType = input.headers.get("content-type") || "";
        }

        const normalized = await normalizeCartRequestBodyForKind(
          kind,
          body,
          contentType,
        );
        if (!normalized.changed) {
          return originalFetch(input, init);
        }
        if (bodyWasReadFromRequest && input instanceof Request && !init) {
          return originalFetch(new Request(input, { body: normalized.body }));
        }
        targetInit.body = normalized.body;
        return originalFetch(input, targetInit);
      } catch {
        return originalFetch(input, init);
      }
    };
  }

  function bindQuantityRuleInteractions() {
    const key = "marginGuardQuantityRuleInteractionsBound";
    if (document.documentElement.dataset[key] === "1") {
      return;
    }
    document.documentElement.dataset[key] = "1";

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const button = target.closest("button, input[type='button'], input[type='submit']");
        if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement)) {
          return;
        }
        const direction = detectQuantityButtonDirection(button);
        if (direction === 0) {
          return;
        }
        const quantityInput = findQuantityInputForButton(button);
        if (!quantityInput) {
          return;
        }
        const rule = resolveQuantityRuleForElement(
          quantityInput,
          state.quantityConstraintsByHandle,
        );
        if (!rule) {
          return;
        }
        if (!isCartQuantityInput(quantityInput)) {
          return;
        }
        const adjustment = adjustQuantityInputBeforeClick(
          quantityInput,
          rule,
          direction,
        );
        if (adjustment.maxBlocked) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );

    document.addEventListener(
      "change",
      (event) => {
        const target = event.target;
        if (!isQuantityInput(target)) {
          return;
        }
        const rule = resolveQuantityRuleForElement(
          target,
          state.quantityConstraintsByHandle,
        );
        if (!rule) {
          return;
        }
        syncQuantityInputForRule(target, rule, {
          allowZero: isCartQuantityInput(target),
          notifyOnMaxClamp: true,
        });
      },
      true,
    );

    document.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        if (!isQuantityInput(target) || !isCartQuantityInput(target)) {
          return;
        }
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const rule = resolveQuantityRuleForElement(
          target,
          state.quantityConstraintsByHandle,
        );
        if (rule) {
          syncQuantityInputForRule(target, rule, {
            allowZero: true,
            notifyOnMaxClamp: true,
          });
        }
        target.dispatchEvent(
          new Event("change", {
            bubbles: true,
          }),
        );
      },
      true,
    );

    document.addEventListener(
      "submit",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLFormElement)) {
          return;
        }
        for (const input of target.querySelectorAll("input")) {
          if (!isQuantityInput(input)) {
            continue;
          }
          const rule = resolveQuantityRuleForElement(
            input,
            state.quantityConstraintsByHandle,
          );
          if (!rule) {
            continue;
          }
          syncQuantityInputForRule(input, rule, {
            allowZero: isCartQuantityInput(input),
            notifyOnMaxClamp: true,
          });
        }
      },
      true,
    );
  }

  function bindDomMutationResync() {
    const key = "marginGuardQuantityMutationObserverBound";
    if (document.documentElement.dataset[key] === "1") {
      return;
    }
    document.documentElement.dataset[key] = "1";
    if (typeof MutationObserver === "undefined") {
      return;
    }

    let syncTimeout = null;
    const observer = new MutationObserver((mutations) => {
      let shouldSync = false;
      let shouldRefreshRules = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) {
            continue;
          }
          if (
            node.matches("input[name='updates[]'], input[name^='updates['], input[data-index]") ||
            node.querySelector("input[name='updates[]'], input[name^='updates['], input[data-index]") ||
            node.matches("a[href*='/products/']") ||
            node.querySelector("a[href*='/products/']")
          ) {
            shouldRefreshRules = true;
          }
          if (
            node.matches("input, form, a[href*='/products/']") ||
            node.querySelector("input, form, a[href*='/products/']")
          ) {
            shouldSync = true;
            break;
          }
        }
        if (shouldSync) {
          break;
        }
      }
      if (!shouldSync) {
        return;
      }
      if (syncTimeout != null) {
        clearTimeout(syncTimeout);
      }
      syncTimeout = window.setTimeout(() => {
        syncTimeout = null;
        if (shouldRefreshRules) {
          run().catch(() => {});
          return;
        }
        syncCartQuantityInputs(state.quantityConstraintsByHandle);
        const currentHandle = extractHandleFromPath(window.location.pathname);
        const currentRule = currentHandle
          ? normalizeQuantityRule(state.quantityConstraintsByHandle[currentHandle])
          : null;
        syncCurrentProductStepNotices(currentRule);
      }, 100);
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function run() {
    const initialHandles = collectHandles();
    const initialProductIds = collectCurrentProductIds();
    if (!initialHandles.length && !initialProductIds.length) {
      return;
    }
    await fetchAndApplyVisibilityPayload(initialHandles, initialProductIds);
    const enrichedContext = await enrichContextWithCartSnapshot(
      initialHandles,
      initialProductIds,
    );
    const handlesUnchanged =
      buildHandlesKey(enrichedContext.handles) === buildHandlesKey(initialHandles);
    const productIdsUnchanged =
      buildProductIdsKey(enrichedContext.productIds) ===
      buildProductIdsKey(initialProductIds);
    if (handlesUnchanged && productIdsUnchanged) {
      return;
    }
    await fetchAndApplyVisibilityPayload(
      enrichedContext.handles,
      enrichedContext.productIds,
    );
  }

  bindCartRequestNormalization();
  bindQuantityRuleInteractions();
  bindDomMutationResync();
  hydrateRulesFromCache();
  startInitialRulesBootstrap();
})();
  `;

  return new Response(script, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
};
