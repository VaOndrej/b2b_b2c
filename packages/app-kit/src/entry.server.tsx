import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";

export const streamTimeout = 5000;

type AddDocumentResponseHeaders = (
  request: Request,
  responseHeaders: Headers,
) => void;

/**
 * Build the React Router SSR request handler shared by every app. The only
 * per-app dependency is the Shopify app's `addDocumentResponseHeaders`, which
 * injects the embedded-app CSP/frame headers.
 */
export function createHandleRequest(
  addDocumentResponseHeaders: AddDocumentResponseHeaders,
) {
  return async function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    reactRouterContext: EntryContext,
  ) {
    addDocumentResponseHeaders(request, responseHeaders);
    const userAgent = request.headers.get("user-agent");
    const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

    return new Promise((resolve, reject) => {
      const { pipe, abort } = renderToPipeableStream(
        <ServerRouter context={reactRouterContext} url={request.url} />,
        {
          [callbackName]: () => {
            const body = new PassThrough();
            const stream = createReadableStreamFromReadable(body);

            responseHeaders.set("Content-Type", "text/html");
            resolve(
              new Response(stream, {
                headers: responseHeaders,
                status: responseStatusCode,
              }),
            );
            pipe(body);
          },
          onShellError(error) {
            reject(error);
          },
          onError(error) {
            responseStatusCode = 500;
            console.error(error);
          },
        },
      );

      // Automatically timeout the React renderer after 6 seconds, which ensures
      // React has enough time to flush down the rejected boundary contents
      setTimeout(abort, streamTimeout + 1000);
    });
  };
}
