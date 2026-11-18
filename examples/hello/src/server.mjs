import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * @param {{verify: (authorization: string|undefined) => Promise<object|null>, podName?: string}} opts
 * @returns {import("node:http").Server & {drain: () => void}}
 */
export function createHello({ verify, podName = "local" }) {
  let draining = false;

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", ...(draining ? { connection: "close" } : {}) });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message) => send(res, status, { code, message, requestId: res.getHeader("x-request-id") });

  const server = createServer(async (req, res) => {
    const supplied = req.headers["x-request-id"];
    res.setHeader("x-request-id", typeof supplied === "string" && REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID()}`);
    const path = (req.url ?? "/").split("?")[0];
    const started = Date.now();
    res.on("finish", () =>
      console.log(JSON.stringify({ msg: "request", requestId: res.getHeader("x-request-id"), method: req.method, path, status: res.statusCode, durationMs: Date.now() - started })),
    );

    try {
      if (req.method === "GET" && path === "/health/live") return send(res, 200, { status: "ok" });
      if (req.method === "GET" && path === "/health/ready") {
        return draining ? fail(res, 503, "unavailable", "Shutting down.") : send(res, 200, { status: "ok" });
      }
      if (!path.startsWith("/v1/")) return fail(res, 404, "not_found", "Not found.");
      const identity = await verify(req.headers.authorization);
      if (!identity) return fail(res, 401, "unauthenticated", "Missing or invalid bearer token.");
      if (req.method === "GET" && path === "/v1/hello") return send(res, 200, { identity, pod: podName });
      return fail(res, 404, "not_found", "Not found.");
    } catch (err) {
      // An undeterminable token (JWKS down) is an outage, never an allow.
      console.log(JSON.stringify({ msg: "error", requestId: res.getHeader("x-request-id"), error: String(err?.name) }));
      if (!res.headersSent) fail(res, 503, "unavailable", "Identity provider unavailable.");
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  /** Stop taking new work: readiness fails, idle keep-alive sockets close, in-flight requests finish. */
  server.drain = () => {
    draining = true;
    server.closeIdleConnections();
  };
  return server;
}
