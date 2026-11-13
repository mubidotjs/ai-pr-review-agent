# Next isolated milestone: prove one actual provider path

This is a proposal, not authorization. Milestone 2.5 used one disposable fixture-only Worker for CPU verification, with no AI binding or inference. It did not change any plan or Projects 1 and 2. See [the actual platform experiment](MILESTONE-2.5-CPU.md) for the ingestion deployment gate; a provider probe cannot waive that gate.

## Two separate gates

The browser architecture removes AST execution from ingestion. Production launch remains separately authorized and must respect the measured ingestion boundary, response extremes, cold starts, and abuse/privacy controls. Keep the full local reviewer functional. A small experiment does not establish reliability across all inputs and locations.

A tiny provider-path probe can be evaluated independently because it runs no GitHub ingestion, Babel, diff analysis, or agent loop. It must not be used to imply that the full application has passed its deployment gate.

## Approval required before provisioning or inference

1. Confirm the intended existing Cloudflare account, Free plan, current Workers AI quota/usage, and allocation shared with Projects 1 and 2. A Project 3 Worker does not create an isolated inference allowance.
2. Recheck current official model eligibility and pricing. Proposed candidate: **`@cf/google/gemma-4-26b-a4b-it`**, subject to the checks below. No paid model, purchased credits, fallback, or plan upgrade. Do **not** use `@cf/meta/llama-3.2-1b-instruct`: Cloudflare schedules its retirement for **November 20, 2026**.
3. Obtain explicit authorization for one minimal isolated Worker deployment/binding and **one inference request**. Proposed caps: at most **256 input tokens, 32 completion tokens, and a 10-Neuron experiment budget**. At currently published Gemma rates, 256 input plus 32 output tokens is approximately **3.20 Neurons**. Recheck the current binding schema and ensure the completion cap covers any reasoning tokens. The Neuron estimate is not an enforceable per-request provider quota; disclose that and stop if a reliable bound cannot be established.
4. State explicitly that the call may consume allowance shared with other projects. Never promise zero impact. If quota is insufficient or cannot be checked, do not call a model.

## Exact experiment

- A minimal deployed Worker route, `POST /api/provider-probe`, using the actual intended `env.AI.run` binding path. No repository/PR input, external investigation tools, or structured review-output integration.
- Protect the route using a temporary backend-only random probe secret, never committed, exposed to the frontend, or logged. Accept only the fixed small probe body. Disable/remove the callable route immediately after collecting the result; do not leave an unrestricted public inference endpoint.
- One synthetic prompt: `Reply with exactly PRISM_PROBE_OK.` One eligible model, a **20-second client timeout**, the above token caps, **zero automatic retries**, zero alternate providers/models.
- Request one text completion, no tools, images, repository content, streaming, agent loop, or review-output parser. The current model documentation prefers `max_completion_tokens` over deprecated `max_tokens`; verify that parameter on the actual binding path before provisioning. Do not assume the older model's response shape.
- Capture deployed commit/version, route, binding identity without secrets, model ID, sanitized request/response shape, status, output text, latency, provider request/usage identifiers if present, and shared quota before/after.
- A timeout may still consume inference allowance. Inspect usage and obtain separate authorization before any second inference. Account-level usage deltas can include concurrent usage by other projects and are not always exact per-call attribution.

## Acceptance and stop conditions

Success means a real nonempty model response through the actual deployed binding, an understood response/error shape, and recorded usage within the separately approved experiment. The literal probe text is a useful sanity check, not a reason to silently retry a successful model request.

Binding/provider failure remains a classified feasibility result. Do not start elaborate agent/output integration, switch to a paid fallback, or repeat inference troubleshooting in a loop. Preserve the independently useful local deterministic reviewer.

Only after provider compatibility is proven should a future milestone design bounded agent tool use and output validation. Server-side evidence must be independently validated from trusted GitHub data; browser findings and `snapshotVerified` flags are not attestations. LangGraph, MCP servers, databases, and distributed queues remain unnecessary.

## Replacement evaluation and account checks (November 13, 2026)

The signed-in account dashboard showed **Workers Free**, **0/10,000 Neurons used today** (reset at 00:00 UTC), and **53.01 Neurons of Gemma 4 usage in the last-24-hour chart**. These are different time windows; the historical usage was pre-existing, not generated by this milestone. Its account model catalog also listed Gemma 4 as Cloudflare-hosted. No inference endpoint, playground submission, AI binding, or model call was used to inspect this information. Account identifiers, email, credentials and runtime request content are excluded from committed evidence.

Both Gemma 4 and `@cf/qwen/qwen3.8-27b` appear in current Cloudflare-hosted documentation without a scheduled retirement notice and are absent from the pricing page's paid-billing-required list. Gemma's published input/output rates are 9,091/27,273 Neurons per million tokens; Qwen's are 40,909/290,909. Gemma is the narrower cost choice for a tiny path probe and has account-specific historical availability evidence. This is **catalog/account eligibility evidence, not proof that the intended `env.AI.run` path works**. Availability, permission, retirement status, cap semantics and shared usage must be checked again immediately before separately authorizing M3. A successful earlier request by another application cannot certify Project 3's binding.

A call may reduce the allowance available to Projects 1 and 2. Concurrent account usage and reporting delay make a before/after delta an imperfect per-call measure. There is no authorization to call a model in M2.5 and no promise of zero impact.

References: [planned model retirements](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/), [Gemma 4 schema](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Qwen 3.8](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/), [Workers AI pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/), [local AI bindings use remote inference](https://developers.cloudflare.com/workers/local-development/).
