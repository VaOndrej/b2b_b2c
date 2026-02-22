import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const settingsUrl = new URL("/app/settings", `${url.protocol}//${url.host}`);
  const result = await ensureCartValidationActive(admin);
  if (!result.ok) {
    settingsUrl.searchParams.set("activation", "error");
    settingsUrl.searchParams.set("message", result.message);
    return Response.redirect(settingsUrl.toString(), 303);
  }

  settingsUrl.searchParams.set("activation", "success");
  settingsUrl.searchParams.set("message", result.message);
  return Response.redirect(settingsUrl.toString(), 303);
};
