import { createVerifier } from "./identity.mjs";
import { createHello } from "./server.mjs";

function config(env) {
  let issuers;
  try {
    issuers = JSON.parse(env.HELLO_ISSUERS ?? "");
  } catch {
    throw new Error("HELLO_ISSUERS must be a JSON array of {issuer,audience,jwksUri,organization,application}");
  }
  const allowHttpJwks = env.HELLO_ALLOW_HTTP_JWKS === "true";
  if (allowHttpJwks && env.NODE_ENV === "production") throw new Error("HELLO_ALLOW_HTTP_JWKS is for development clusters only");
  const drainMs = Number(env.HELLO_DRAIN_MS ?? 5000);
  if (!Number.isInteger(drainMs) || drainMs < 0 || drainMs > 60_000) throw new Error("HELLO_DRAIN_MS must be 0-60000");
  return { issuers, allowHttpJwks, drainMs, port: Number(env.PORT ?? 8080) };
}

const cfg = config(process.env);
const server = createHello({ verify: createVerifier(cfg.issuers, cfg), podName: process.env.POD_NAME });
server.listen(cfg.port, "0.0.0.0", () => console.log(JSON.stringify({ msg: "listening", port: cfg.port })));

process.once("SIGTERM", () => {
  // Fail readiness first so the endpoint controller removes us, then close.
  server.drain();
  setTimeout(() => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // Hard stop if a request outlives the grace period.
    setTimeout(() => process.exit(1), 10_000).unref();
  }, cfg.drainMs).unref();
});
