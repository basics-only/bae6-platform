# bae6-platform

Deployment and integration for the bae6 products. It deploys independently versioned
images; it contains no product code.

| Path | Purpose |
|---|---|
| `charts/bae6-service` | One hardened Helm chart; each runtime is a separate release of it (ADR-0008) |
| `examples/hello` | Reference service: identity validation, health, graceful shutdown, negative auth tests |
| `dev/mock-oidc` | Development-only token issuer for local and CI tests |
| `dev/kind` | Local Kubernetes smoke test: 1→3 replicas, killed pod, rolling restart |
| `docs/` | Secrets and workload identity conventions, runbooks |

Cross-product decisions and plans: [bae6-contracts](https://github.com/basics-only/bae6-contracts).

## License
Apache-2.0.
