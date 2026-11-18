// Development-only OIDC issuer: serves a JWKS and mints tokens on request.
// Anyone who can reach it can mint any identity, so it refuses production and must never be exposed.
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

if (process.env.NODE_ENV === "production") throw new Error("mock-oidc must not run in production");
const issuer = process.env.MOCK_OIDC_ISSUER;
if (!issuer) throw new Error("MOCK_OIDC_ISSUER is required (the iss value services trust)");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" }] });

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error("too large");
  }
  return JSON.parse(raw || "{}");
}

createServer(async (req, res) => {
  const send = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof value === "string" ? value : JSON.stringify(value));
  };
  if (req.method === "GET" && req.url === "/.well-known/jwks.json") return send(200, jwks);
  if (req.method === "GET" && req.url === "/health/live") return send(200, { status: "ok" });
  if (req.method !== "POST" || req.url !== "/token") return send(404, { code: "not_found", message: "Not found.", requestId: "mock" });
  try {
    // {sub, aud, scope?, claims?, ttlSeconds?}
    const { sub, aud, scope, claims = {}, ttlSeconds = 300 } = await body(req);
    if (typeof sub !== "string" || typeof aud !== "string" || !Number.isInteger(ttlSeconds) || ttlSeconds < -3600 || ttlSeconds > 3600) {
      return send(400, { code: "invalid_request", message: "sub and aud are required; ttlSeconds in [-3600, 3600].", requestId: "mock" });
    }
    const token = await new SignJWT({ ...claims, ...(scope ? { scope } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: "mock-1" })
      .setIssuer(issuer)
      .setSubject(sub)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(privateKey);
    send(200, { access_token: token, token_type: "Bearer" });
  } catch {
    send(400, { code: "invalid_request", message: "Body must be JSON under 4 KiB.", requestId: "mock" });
  }
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
