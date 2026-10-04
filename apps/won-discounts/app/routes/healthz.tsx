// Liveness for the host (fly.toml http_service.checks): the process answers. No auth, no database, no shop data.
export const loader = () => new Response("ok", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
