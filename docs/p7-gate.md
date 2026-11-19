# P7 gate

Stack: `integration/compose.yaml`. Demo: `node --test integration/demo.test.mjs` (5 pass). Load: `node integration/load.mjs`. All cloud providers are mocks; live smoke tests are pending.

## Version matrix

Pinned in `integration/versions.yaml`.

| Runtime | Version | Image |
|---|---|---|
| bae6-ai-gateway | v0.1.2 | 164 MB |
| bae6-context-data-api | v0.1.0 | 164 MB |
| bae6-context-embed-api | v0.1.0 | 164 MB |
| bae6-context-mcp-registry | v0.1.0 | 164 MB |
| bae6-authz-api | v0.1.0 | ~500 MB (not in the integration stack) |

Contracts v0.1.0. Chart `bae6-service` 0.1.0.

## Footprint

Idle 14-21 MB per runtime, Postgres 28 MB. After load: gateway 76 MB, data-api 100 MB, embed-api 67 MB. mcp-registry was not loaded.

## Load

16 concurrent clients, 10 s per scenario, one laptop, mock providers, one token and one organization. No 5xx, no network errors or timeouts, no crashes. Latency is for 200 responses only.

Search and read answer most requests with 429, the services' per-organization admission limit, so their 200 rate measures the limiter, not capacity. Only chat (no 429s) measures throughput. Per-organization tokens would be needed for capacity numbers.

| Scenario | Requests | ok rps | p50 / p95 / p99 ms | Statuses |
|---|---|---|---|---|
| chat | 4125 | 412 | 35 / 75 / 97 | 4125 x 200 |
| search | 16209 | 180 | 48 / 74 / 101 | 1807 x 200, 14402 x 429 |
| read | 26460 | 1839 | 6 / 13 / 22 | 18409 x 200, 8051 x 429 |

## Rollback drills

- Hard kill of the gateway: ready in 3 s, spend preserved, no leaked reservations, demo passes.
- Gateway image v0.1.0 on v0.1.1 config: starts, ignores `endpoint` silently and would call real Bedrock (observed as a 502 against mock credentials). Revert config before image. Not re-run against v0.1.2.

## Security review

Read-only review of tenant isolation, issuer-to-org binding, token handling, SSRF controls and bounded resources. No isolation break found in the code read, but S1 and S3 below are cross-tenant risks that the single-organization demo cannot show. Not a clean pass.

| Finding | Status |
|---|---|
| F1 gateway dev flags fail open | Fixed in bae6-ai v0.1.2, regression test in `main.test.ts` |
| F2 gateway has no per-org in-flight limit | Open, follow-up |
| F3 mcp-registry has no host allowlist by default | Accepted, set `BAE6_MCP_ALLOWED_HOST_SUFFIXES` in production |
| F4 chart egress default is empty | Accepted, deny by default |
| F5 integration images not digest-pinned | Accepted, dev only |
| S1 embed-api uses one AI token for every org | Open, run one embed deployment per org |
| S2 S3 endpoint has no host allowlist | Open |
| S3 embed principals ignore subject type | Open |
| S4 embed `BAE6_AI_URL` is not validated | Open |
| S5 data-api has one scope for all operations | By design |

Not reviewed: data-postgres and databricks adapters, full ai-core provider clients, dependency CVEs, a rendered chart.
