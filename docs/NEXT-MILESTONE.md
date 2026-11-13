# Smallest next milestone: prove the provider path

This document is a proposal. No model call, cloud deployment, AI binding, paid subscription, DNS change, or modification to another project is authorized by its existence.

## Entry conditions

1. Review the CPU results and agree a bounded deterministic production architecture before deploying the full review workload.
2. Inspect the intended Cloudflare account and its **shared** Workers AI daily usage, current plan, eligible free model, remaining allowance, and usage by Projects 1 and 2. A new Worker does not create an isolated inference quota.
3. Obtain separate authorization for the minimal deployed Project 3 execution path and an explicit small inference budget. State that consuming shared allowance can affect other projects; do not promise zero impact.
4. If usage cannot be checked, the allowance is insufficient, or the selected model needs billing, stop. Do not upgrade, buy credits, or switch to a paid fallback.

## Experiment

- Use the exact intended deployed Worker route and binding/provider API, rather than a local-only SDK success.
- One small synthetic prompt, one eligible model, at most 128 output tokens, a strict request timeout, no retries, no agent loop, no external tools, and no fallback model.
- Record model ID, deployed commit/version, route, binding identity without secrets, sanitized request/response shape, status, latency, usage before/after, and error classification.
- Verify actual output and binding/provider compatibility before designing structured review-output integration. A timeout does not prove inference was free or cancelled remotely; inspect usage before any separately approved retry.

## Acceptance

A single real response through the deployed execution path, understood response/error semantics, and measured shared-quota impact within the separately approved budget. Failure stays a documented provider blocker; deterministic local review remains independently useful.

Only after this proof should the adapter gain bounded investigation steps, structured candidates, evidence rejection, prompt-injection tests, and human approval flows. LangGraph, MCP servers, databases, and distributed infrastructure remain unnecessary unless a demonstrated requirement appears.

References: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [local AI bindings use remote inference](https://developers.cloudflare.com/workers/local-development/).
