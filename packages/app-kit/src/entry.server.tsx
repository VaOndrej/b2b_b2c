import { Transform } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";

export const streamTimeout = 5000;

/**
 * The document's body stream, minus NUL bytes. React 18.3.1 on Node 26 was seen writing a 0x00 in front of a
 * non-ASCII letter that fell on the edge of one of its 2 048-byte chunks ("vr\0áceno"; found 12 Oct 2026 in Won
 * Discounts, reproduced with renderToPipeableStream alone, renderToString is clean). The browser draws the byte as
 * "\uFFFD" in the middle of a Czech word. A NUL is never part of an HTML document, so dropping it is always safe.
 */
export function withoutNulBytes(): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      done(null, chunk.includes(0) ? Buffer.from(chunk.filter((byte) => byte !== 0)) : chunk);
    },
  });
}

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
            const body = withoutNulBytes();
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
