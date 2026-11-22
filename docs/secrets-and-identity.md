# Secrets and workload identity conventions

## Workload identity
- Every runtime gets its own ServiceAccount (the chart creates one per release).
  No two runtimes share one.
- Cloud access uses the cloud's workload identity, configured with
  `serviceAccount.annotations`:
  - EKS: `eks.amazonaws.com/role-arn: arn:aws:iam::<acct>:role/<runtime>` (IRSA) or an
    EKS Pod Identity association.
  - GKE: `iam.gke.io/gcp-service-account: <runtime>@<project>.iam.gserviceaccount.com`.
- One IAM role per runtime, with least privilege. For example, the ai-gateway role may call
  `bedrock:InvokeModel*` on listed model ARNs only, and the ingestion-worker role may
  `s3:GetObject`/`ListBucket` on listed prefixes only.
- Service-to-service calls authenticate with OIDC tokens for the callee's audience
  (bae6-contracts ADR-0003). Never use static shared API keys between bae6 services.
- `automountServiceAccountToken` is off unless a runtime needs a projected token.

## Secrets
- Cloud provider credentials are never stored: not in Secrets, values, or images. The
  ai-gateway gets them from workload identity (EKS Pod Identity or IRSA; GKE Workload
  Identity for Vertex). Static AWS keys work only locally, from a `.env`, under
  `NODE_ENV=development`; the gateway refuses to start with them anywhere else
  (bae6-contracts ADR-0013).
- Hugging Face has no workload identity, so its tokens are the one provider credential that
  is stored. Put each in a Kubernetes Secret and reference it through `envFromSecrets` under
  the name a model's `tokenEnv` gives (`BAE6_HF_TOKEN_*`). Use a fine-grained read token per
  endpoint, never a personal account token. The gateway sends it only to
  `router.huggingface.co` or `<name>.endpoints.huggingface.cloud` (bae6-contracts ADR-0015).
- Values that are secret (database URLs with passwords) go in Kubernetes Secrets, referenced through
  `envFromSecrets`. They are never put in `env`, ConfigMaps, values files in git, or images.
- In production, Secrets are synced from the cloud secret manager (External Secrets
  Operator, or the CSI secrets driver). bae6 does not require either; pick one per cluster.
- Each runtime reads only its own Secret. Namespace RBAC denies `get secrets` to people and
  workloads that do not need it.
- Rotation: rotate in the secret manager, then `kubectl rollout restart` the runtime. The
  rollout keeps capacity (`maxUnavailable: 0`).

## Never
- Log, echo, or put in error messages any token or secret.
- Forward an inbound token to a service that is not its audience.
- Ship `dev/mock-oidc` or any `allowTag: true` values outside development clusters.
