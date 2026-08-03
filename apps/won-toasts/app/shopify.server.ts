import { createShopifyApp, apiVersion } from "@won/app-kit/shopify.server";
import prisma from "./db.server";

const shopify = createShopifyApp(prisma);

export default shopify;
export { apiVersion };
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
