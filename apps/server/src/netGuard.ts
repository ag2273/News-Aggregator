// Surviving a publisher's broken connection (#58).
//
// WHY THIS EXISTS
// ---------------
// Measured on the production box, and reproduced locally: one publisher closing an
// HTTP/2 stream mid-page makes undici emit `error` on the stream itself, which Node
// raises as an UNCAUGHT exception. Nothing in the request path catches it — the
// `try` around `request()` only wraps the await — so the process exits.
//
// The log from the crash is exactly that:
//
//   Error [ERR_HTTP2_STREAM_ERROR]: Stream closed with error code NGHTTP2_PROTOCOL_ERROR
//   Emitted 'error' event on ClientHttp2Stream instance at: …
//
// The container restarted, re-ingested 29 feeds, and — because these publishers reset
// streams routinely, not once — went under again. That is the hang the user felt as
// "the app opened but news never loaded": each restart served traffic briefly, then
// died mid-request.
//
// WHAT THIS IS NOT
// ----------------
// It is not a blanket "ignore every exception". A crash caused by our own bug must
// still crash loudly: only the broken-connection family is swallowed, and each one is
// logged. Anything else is re-thrown untouched.

/** The errors a publisher can raise through undici/http2 that mean "this page failed". */
export function isPublisherStreamFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return (
    code === 'ERR_HTTP2_STREAM_ERROR' ||
    code === 'ERR_HTTP2_STREAM_CANCEL' ||
    code === 'ERR_HTTP2_SESSION_ERROR' ||
    code === 'ERR_HTTP2_GOAWAY_SESSION' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_CLOSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE'
  );
}

/**
 * Install the guard. Returns an uninstall function, so a test can use it without
 * leaking a handler into the rest of the suite.
 *
 * `onSwallow` is injectable so a test can assert the log line without capturing
 * stderr.
 */
export function installPublisherErrorGuard(
  onSwallow: (error: unknown) => void = (error) => {
    const code = (error as { code?: string }).code;
    console.warn(`[net] publisher connection failed (${code}) — request dropped, server stays up`);
  },
): () => void {
  const handler = makePublisherErrorHandler(onSwallow);
  process.on('uncaughtException', handler);
  return () => process.off('uncaughtException', handler);
}

/**
 * The handler itself, as a plain function.
 *
 * Separate from `installPublisherErrorGuard` so its decision can be tested by calling
 * it directly: driving node's real `uncaughtException` event to test a re-throw would
 * either kill the test process or be swallowed by the runner, which proves nothing.
 */
export function makePublisherErrorHandler(
  onSwallow: (error: unknown) => void,
): (error: unknown) => void {
  return (error: unknown) => {
    if (isPublisherStreamFailure(error)) {
      onSwallow(error);
      return;
    }
    // Not ours to swallow: re-throw, so a real bug still takes the process down and
    // shows up in the logs instead of being silently hidden.
    throw error;
  };
}
