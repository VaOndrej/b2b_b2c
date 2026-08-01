import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  url.pathname = "/app/health";
  return Response.redirect(url.toString(), 302);
};

export default function AppViolationsRoute() {
  return null;
}
