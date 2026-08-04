import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../shopify.server";

/**
 * Root route (`/`). Shopify admin loads the embedded app at `/` (not `/app`),
 * passing `?shop=...&host=...&id_token=...`. Without this route that request
 * 404s and the iframe stays blank. When a `shop` param is present we forward
 * everything to `/app`, where `authenticate.admin` runs the token exchange.
 * Otherwise we show a tiny shop-domain login form.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>App name</h1>
      {showForm && (
        <Form method="post" action="/auth/login" style={{ display: "grid", gap: 8, marginTop: 16 }}>
          <label>
            Shop domain
            <input type="text" name="shop" placeholder="my-shop.myshopify.com" style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
          </label>
          <button type="submit" style={{ padding: "8px 16px", width: "fit-content" }}>
            Log in
          </button>
        </Form>
      )}
    </div>
  );
}
