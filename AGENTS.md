# bae6 coding agent operating guide

You are implementing bae6 according to the plans in [bae6-contracts/docs/plans](https://github.com/basics-only/bae6-contracts/tree/main/docs/plans) (start with `00-MASTER-PLAN.md`) and the relevant service plan. No scope expansion without an ADR.

## Git
- Use a main, dev paradigm for our branches. 
- Branch off of dev with things like epic/** and feature/**. features can be PRed into epics. epics can be PRed into dev. dev can be PRed into main. 
- Use milestones in github to denote epics

## Agent working method
1. Read existing repository code, contracts and ADRs before editing. The existing riz work should be preserved when evolving `bae6-authz`.
2. Define/confirm API schema and its compatibility implications before implementing a new public endpoint.
3. Plan the smallest vertical slice with tests and measure dependency footprint.
4. Implement strict identity verification, tenant isolation, fail-closed policies and bounded runtime behavior from the first slice.
5. Write unit + contract + adversarial negative tests, then integration tests with fakes or real test dependencies.
6. Provide TS and Python SDK parity for public endpoints.
7. Ensure Docker/Helm probes, graceful shutdown, resource limits and independent replicas.
8. Produce a concise PR summary: contract changes, migration impact, new dependencies (why), tests, benchmarks, deployment/rollback implications.

## Hard constraints
- Product names are `bae6-authz`, `bae6-ai`, `bae6-context`, `bae6-contracts`, `bae6-platform`; do not use `riz` in new product names.
- Never add AWS/GCP providers other than Bedrock/Vertex to ai-core.
- No mandatory LangChain in ai-core or agent runtime; integrations optional.
- No unrelated cross-service DB accesses, implicit shared singleton process state, global release train, or runtime dependency on control-plane availability.
- No unbounded retries, queues, file sizes, token generation, tools or database results.
- No placeholder security checks that accept all identities or permissions.
- Avoid infrastructure/SDK dependencies when standard language facilities suffice.

## Completion format
- Report implemented endpoints/modules, exact test commands and outcomes, security/reliability edge cases covered, measured footprint, open risks, follow-on issues and version/compatibility notes.

## Reference bae6-authz code
- Look to https://github.com/quentin-auster/riz for the bae6-authz service. We should work off of that. 

## Typescript
- use pnpm for package management and testing
- Stick to base TS where possible. 

## Python
- Use uv for package management
- Use pytest for testing
- Lint with ruff