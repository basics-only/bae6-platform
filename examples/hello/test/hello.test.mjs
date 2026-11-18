import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT, UnsecuredJWT } from "jose";
import { createVerifier } from "../src/identity.mjs";
import { createHello } from "../src/server.mjs";

const ISS = "https://idp.test";
const AUD = "hello";
let key, otherKey, jwksServer, hello, base, downHello, downBase;

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

before(async () => {
  key = await generateKeyPair("RS256");
  otherKey = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256" };
  jwksServer = createServer((_, res) => res.end(JSON.stringify({ keys: [jwk] })));
  const jwksUri = `${await listen(jwksServer)}/jwks`;
  const issuers = [{ issuer: ISS, audience: AUD, jwksUri, organization: "acme", application: "crm" }];
  hello = createHello({ verify: createVerifier(issuers, { allowHttpJwks: true }) });
  base = await listen(hello);
  // Same config, but the JWKS endpoint refuses connections.
  const dead = [{ ...issuers[0], jwksUri: "http://127.0.0.1:9/jwks" }];
  downHello = createHello({ verify: createVerifier(dead, { allowHttpJwks: true }) });
  downBase = await listen(downHello);
});

after(() => {
  for (const s of [jwksServer, hello, downHello]) s.closeAllConnections?.(), s.close();
});

const now = () => Math.floor(Date.now() / 1000);
const sign = (claims = {}, { k = key.privateKey, header = {} } = {}) =>
  new SignJWT({ sub: "alice", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1", ...header })
    .setIssuer(claims.iss ?? ISS)
    .setAudience(claims.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? now() + 300)
    .sign(k);

const get = (token, { url = base, path = "/v1/hello", headers = {} } = {}) =>
  fetch(`${url}${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });

test("a valid token gets its tenant from the issuer mapping", async () => {
  const res = await get(await sign({ organization: "evil", org_id: "evil" }));
  assert.equal(res.status, 200);
  const { identity } = await res.json();
  assert.equal(identity.subjectId, "alice");
  assert.equal(identity.organizationId, "acme");
  assert.equal(identity.applicationId, "crm");
});

test("a client-credentials token is a workload", async () => {
  const res = await get(await sign({ sub: "crm-backend", client_id: "crm-backend" }));
  assert.equal((await res.json()).identity.subjectType, "workload");
});

const rejected = {
  "no token": async () => undefined,
  "not a JWT": async () => "abc",
  "wrong audience": () => sign({ aud: "other" }),
  "unknown issuer": () => sign({ iss: "https://evil.test" }),
  "expired beyond skew": () => sign({ exp: now() - 120 }),
  "not yet valid beyond skew": () =>
    new SignJWT({ sub: "alice" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD)
      .setNotBefore(now() + 300).setExpirationTime(now() + 600).sign(key.privateKey),
  "signed by a key not in the issuer's JWKS, same kid": () => sign({}, { k: otherKey.privateKey }),
  "jku header pointing at the attacker's keys": () => sign({}, { k: otherKey.privateKey, header: { jku: "https://evil.test/jwks" } }),
  "alg none": async () => new UnsecuredJWT({ sub: "alice" }).setIssuer(ISS).setAudience(AUD).setExpirationTime("5m").encode(),
  "HS256 with a guessable secret": () =>
    new SignJWT({ sub: "alice" }).setProtectedHeader({ alg: "HS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD)
      .setExpirationTime("5m").sign(new TextEncoder().encode("secret")),
  "issued in the future beyond skew": () =>
    new SignJWT({ sub: "alice" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD)
      .setIssuedAt(now() + 3600).setExpirationTime(now() + 7200).sign(key.privateKey),
  "no subject": () =>
    new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(AUD).setExpirationTime("5m").sign(key.privateKey),
};

for (const [name, make] of Object.entries(rejected)) {
  test(`rejects ${name} with 401 and an error envelope`, async () => {
    const res = await get(await make());
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "unauthenticated");
    assert.equal(body.requestId, res.headers.get("x-request-id"));
  });
}

test("an http JWKS is refused unless explicitly allowed", () => {
  const issuer = { issuer: ISS, audience: AUD, jwksUri: "http://127.0.0.1/jwks", organization: "acme", application: "crm" };
  assert.throws(() => createVerifier([issuer]), /must be https/);
});

test("an unreachable JWKS fails closed with 503, not an allow", async () => {
  const res = await get(await sign(), { url: downBase });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "unavailable");
});

test("a well-formed request ID is echoed and a malformed one replaced", async () => {
  assert.equal((await get(undefined, { path: "/health/live", headers: { "x-request-id": "abc-1" } })).headers.get("x-request-id"), "abc-1");
  const replaced = (await get(undefined, { path: "/health/live", headers: { "x-request-id": "a b;c" } })).headers.get("x-request-id");
  assert.match(replaced, /^req_[0-9a-f-]{36}$/);
});

test("unknown /v1 paths still require authentication", async () => {
  assert.equal((await get(undefined, { path: "/v1/other" })).status, 401);
});

test("readiness fails once draining starts while liveness stays up", async () => {
  const s = createHello({ verify: async () => null });
  const url = await listen(s);
  assert.equal((await fetch(`${url}/health/ready`)).status, 200);
  s.drain();
  assert.equal((await fetch(`${url}/health/ready`)).status, 503);
  assert.equal((await fetch(`${url}/health/live`)).status, 200);
  s.closeAllConnections();
  s.close();
});
