# P7 gate

Stack: `integration/compose.yaml`. Demo: `node --test integration/demo.test.mjs` (5 pass). Load: `node integration/load.mjs`. All cloud providers are mocks; live smoke tests are pending.

## Version matrix

Pinned in `integration/versions.yaml`.

| Runtime | Version | Image |
|---|---|---|
| bae6-ai-gateway | v0.1.4 | 164 MB |
| bae6-context-data-api | v0.1.2 | 164 MB |
| bae6-context-embed-api | v0.1.2 | 164 MB |
| bae6-context-mcp-registry | v0.1.2 | 164 MB |
| bae6-authz-api | v0.1.0 | ~500 MB (not in the integration stack) |

Contracts v0.1.0. Chart `bae6-service` 0.1.0.

## Footprint

Idle 14-21 MB per runtime, Postgres 28 MB. After load: gateway 76 MB, data-api 100 MB, embed-api 67 MB. mcp-registry was not loaded. Memory was measured on the v0.1.0 to v0.1.2 images and not re-measured after the hardening releases.

## Load

16 concurrent clients, 10 s per scenario, one laptop, mock providers, one token and one organization. No 5xx, no network errors or timeouts, no crashes. Latency is for 200 responses only.

Search and read answer most requests with 429, the services' per-organization admission limit, so their 200 rate measures the limiter, not capacity. Only chat (no 429s) measures throughput. Per-organization tokens would be needed for capacity numbers.

| Scenario | Requests | ok rps | p50 / p95 / p99 ms | Statuses |
|---|---|---|---|---|
| chat | 6538 | 653 | 21 / 49 / 72 | 6538 x 200 |
| search | 23322 | 250 | 33 / 56 / 73 | 2509 x 200, 20813 x 429 |
| read | 34649 | 2703 | 4 / 10 / 17 | 27048 x 200, 7601 x 429 |

Measured on the hardened images (gateway v0.1.4, context v0.1.2). An earlier run on the previous images gave chat 412 rps; the difference is likely laptop load rather than the releases, and was not repeated.

## Rollback drills

- Hard kill of the gateway: ready in 3 s, spend preserved, no leaked reservations, demo passes.
- Gateway image v0.1.0 on v0.1.1 config: starts, ignores `endpoint` silently and would call real Bedrock (observed as a 502 against mock credentials). Revert config before image. Not re-run against v0.1.4.

## Security review

Read-only review of tenant isolation, issuer-to-org binding, token handling, SSRF controls and bounded resources. No isolation break found in the code read, but S1 and S3 below are cross-tenant risks that the single-organization demo cannot show. Not a clean pass.

| Finding | Status |
|---|---|
| F1 gateway dev flags fail open | Fixed in bae6-ai v0.1.2, regression test in `main.test.ts` |
| F2 gateway has no per-org in-flight limit or body deadline | Fixed in bae6-ai v0.1.4. The per-org cap is off until `BAE6_MAX_INFLIGHT_PER_ORG` is set; the 15 s idle body deadline is always on |
| F3 mcp-registry has no host allowlist by default | Fixed in bae6-context v0.1.2: refuses to start without `BAE6_MCP_ALLOWED_HOST_SUFFIXES` unless the dev flag is set |
| F4 chart egress default is empty | Accepted, deny by default |
| F5 integration images not digest-pinned | Accepted, dev only |
| S1 embed-api uses one AI token for every org | Fixed in v0.1.2: a config naming more than one organization is refused, so run one embed deployment per org |
| S2 S3 endpoint has no host allowlist | Fixed in v0.1.2 for non-AWS hosts. Any `*.amazonaws.com` host is still accepted, including ones other AWS customers control |
| S3 embed principals ignore subject type | Fixed in v0.1.2. ACLs that matched a workload as `user:<id>` must use `workload:<id>` |
| S4 embed `BAE6_AI_URL` is not validated | Fixed in v0.1.2 for hosts outside the cluster. In-cluster `*.svc.cluster.local` http is still allowed, so the token is plaintext until the gateway serves TLS |
| S5 data-api has one scope for all operations | By design |

Not reviewed: data-postgres and databricks adapters, full ai-core provider clients, dependency CVEs, a rendered chart.
