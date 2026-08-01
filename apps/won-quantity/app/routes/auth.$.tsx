import { createAuthSplatRoute } from "@won/app-kit/auth";
import { authenticate } from "../shopify.server";

const route = createAuthSplatRoute(authenticate);

export const loader = route.loader;
export const headers = route.headers;
