// Token → IdentityContext, following bae6-contracts docs/style-guide.md#identity.
// Ported from bae6-authz (riz) apps/api/src/auth/oidc.ts.
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

const ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"];
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
// jose errors that mean "this token is invalid"; anything else is an outage and must throw.
const INVALID = new Set([
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JOSE_NOT_SUPPORTED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

/**
 * @param {{issuer:string,audience:string,jwksUri:string,organization:string,application:string}[]} issuers
 *   Trusted issuers and the tenant each maps to (ADR-0002). Never taken from token claims.
 * @param {{allowHttpJwks?: boolean}} [opts] http JWKS for in-cluster dev issuers only.
 * @returns {(authorization: string|undefined) => Promise<object|null>} null = invalid; throws = undeterminable.
 */
export function createVerifier(issuers, opts = {}) {
  if (!Array.isArray(issuers) || issuers.length === 0) throw new Error("at least one issuer is required");
  const byIssuer = new Map();
  for (const i of issuers) {
    if (!SLUG.test(i.organization ?? "") || !SLUG.test(i.application ?? "")) {
      throw new Error(`issuer ${i.issuer}: organization and application must be slugs`);
    }
    const jwks = new URL(i.jwksUri);
    const local = jwks.hostname === "localhost" || jwks.hostname === "127.0.0.1";
    if (jwks.protocol !== "https:" && !(jwks.protocol === "http:" && (local || opts.allowHttpJwks))) {
      throw new Error(`issuer ${i.issuer}: jwksUri must be https`);
    }
    if (byIssuer.has(i.issuer)) throw new Error(`duplicate issuer ${i.issuer}`);
    byIssuer.set(i.issuer, {
      ...i,
      // Cached; refetched on unknown kid at most every 30 s; each fetch bounded.
      keys: createRemoteJWKSet(jwks, { cooldownDuration: 30_000, cacheMaxAge: 600_000, timeoutDuration: 5_000 }),
    });
  }

  return async (authorization) => {
    const token = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "")?.[1];
    if (!token || token.length > 8192) return null;
    let iss;
    try {
      iss = decodeJwt(token).iss; // unverified; only selects the keys, jwtVerify re-checks it
    } catch {
      return null;
    }
    const cfg = typeof iss === "string" ? byIssuer.get(iss) : undefined;
    if (!cfg) return null;
    let payload;
    try {
      ({ payload } = await jwtVerify(token, cfg.keys, {
        issuer: cfg.issuer,
        audience: cfg.audience,
        algorithms: ALGORITHMS,
        clockTolerance: 60,
        requiredClaims: ["exp", "sub"],
      }));
    } catch (err) {
      if (INVALID.has(err?.code)) return null;
      throw err;
    }
    if (typeof payload.sub !== "string" || payload.sub === "" || payload.sub.length > 256) return null;
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean)
      : Array.isArray(payload.scp) ? payload.scp.filter((s) => typeof s === "string") : [];
    return {
      subjectId: payload.sub,
      // Client-credentials tokens name the client as their own subject.
      subjectType: payload.sub === (payload.client_id ?? payload.azp) ? "workload" : "user",
      organizationId: cfg.organization,
      applicationId: cfg.application,
      issuer: cfg.issuer,
      audience: cfg.audience,
      scopes: [...new Set(scopes)].slice(0, 100),
    };
  };
}
