# Next isolated milestone: prove one actual provider path

This is a proposal, not authorization. Milestone 2 deployed no resource, enabled no AI binding, changed no plan, and made no inference call. Projects 1 and 2 remain untouched.

## Two separate gates

The browser architecture removes AST execution from ingestion. Full PRISM deployment still requires separately authorized on-platform CPU validation of ingestion at its existing limits, cold starts, and tails. Local reports do not establish Workers Free compliance. Keep the local application functional while this remains unresolved.

A tiny provider-path probe can be evaluated independently because it runs no GitHub ingestion, Babel, diff analysis, or agent loop. It must not be used to imply that the full application has passed its deployment gate.

## Approval required before provisioning or inference

1. Confirm the intended existing Cloudflare account, Free plan, current Workers AI quota/usage, and allocation shared with Projects 1 and 2. A Project 3 Worker does not create an isolated inference allowance.
2. Recheck current official model eligibility and pricing. Candidate: `@cf/meta/llama-3.2-1b-instruct`, only if it remains available without billing. No paid model, credits, fallback, or plan upgrade.
3. Obtain explicit authorization for one minimal isolated Worker deployment/binding and **one inference request**. Proposed token caps: at most **256 input tokens and 32 output tokens**. Use current pricing to estimate a budget no greater than **100 Neurons** before running. The neuron estimate is not an enforceable per-request provider quota; disclose that and stop if a reliable estimate cannot be made.
4. State explicitly that the call may consume allowance shared with other projects. Never promise zero impact. If quota is insufficient or cannot be checked, do not call a model.

## Exact experiment

- A minimal deployed Worker route, `POST /api/provider-probe`, using the actual intended `env.AI.run` binding path. No repository/PR input, external investigation tools, or structured review-output integration.
- Protect the route using a temporary backend-only random probe secret, never committed, exposed to the frontend, or logged. Accept only the fixed small probe body. Disable/remove the callable route immediately after collecting the result; do not leave an unrestricted public inference endpoint.
- One synthetic prompt: `Reply with exactly PRISM_PROBE_OK.` One eligible model, a **20-second client timeout**, the above token caps, **zero automatic retries**, zero alternate providers/models.
- Capture deployed commit/version, route, binding identity without secrets, model ID, sanitized request/response shape, status, output text, latency, provider request/usage identifiers if present, and shared quota before/after.
- A timeout may still consume inference allowance. Inspect usage and obtain separate authorization before any second inference. Account-level usage deltas can include concurrent usage by other projects and are not always exact per-call attribution.

## Acceptance and stop conditions

Success means a real nonempty model response through the actual deployed binding, an understood response/error shape, and recorded usage within the separately approved experiment. The literal probe text is a useful sanity check, not a reason to silently retry a successful model request.

Binding/provider failure remains a classified feasibility result. Do not start elaborate agent/output integration, switch to a paid fallback, or repeat inference troubleshooting in a loop. Preserve the independently useful local deterministic reviewer.

Only after provider compatibility is proven should a future milestone design bounded agent tool use and output validation. Server-side evidence must be independently validated from trusted GitHub data; browser findings and `snapshotVerified` flags are not attestations. LangGraph, MCP servers, databases, and distributed queues remain unnecessary.

References: [Workers AI pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/), [local AI bindings use remote inference](https://developers.cloudflare.com/workers/local-development/).
