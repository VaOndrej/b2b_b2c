import { createHandleRequest, streamTimeout } from "@won/app-kit/entry.server";
import { addDocumentResponseHeaders } from "./shopify.server";

export { streamTimeout };

export default createHandleRequest(addDocumentResponseHeaders);
