# AI decision error classification

Review baseline: `70e18b6e3f9c2f84e87456932a2dbb6806442223`. Transport acceptance remains **PASS**. This correction changes only safe AI/relay classification and response validation. No deployment, inference, transport experiment, model/prompt change, review-limit change or risk-category expansion was performed.

## What the existing evidence establishes

The [last live attempt](release-acceptance-result.json) recorded one native-dispatch reservation, zero adapter-validated decisions, `MODEL_ERROR`, and a retained 97.983 estimated-Neuron reservation. Those facts cannot identify the rejected native content or its exact failure branch. Provider failure, response-envelope rejection, token-bound rejection and invalid decision JSON must not be conflated. The old attempt cannot be retroactively diagnosed from new mock results.

The baseline had a reproducible loss of classification: `WorkersAiAdapter` forwarded only five relay error codes. `INVALID_MODEL_RESPONSE`, `PROVIDER_TOKEN_BOUND` and `INVALID_CONTRACT` became `MODEL_ERROR`. `PrivateRelay` accepted arbitrary uppercase error strings, and native-body JSON failures surfaced as generic request-body errors. These paths are corrected with an exact shared allowlist and stage-appropriate codes; unexpected messages, provider bodies, schema issues and exception details are never returned or logged.

| Boundary / observation                                                                             | Preserved safe code                       |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Invalid `/decide` input or tool contract                                                           | `INVALID_CONTRACT`                        |
| Native binding rejection / non-success HTTP / HTTP 429                                             | `PROVIDER_ERROR` / `PROVIDER_QUOTA`       |
| Native or relay-call timeout                                                                       | `PROVIDER_TIMEOUT`                        |
| Native return is not a Response, bounded JSON cannot decode, or envelope is unsupported            | `PROVIDER_SHAPE`                          |
| Prompt/completion bound exceeded, or reported reasoning tokens despite thinking disabled           | `PROVIDER_TOKEN_BOUND`                    |
| Native assistant content is not strict decision JSON, or its tool arguments/schema are unsupported | `INVALID_MODEL_RESPONSE`                  |
| Node cannot reach the relay, or receives an unknown error/gateway error                            | `RELAY_UNAVAILABLE`                       |
| Successful relay HTTP body or normalized decision envelope is invalid                              | `RELAY_RESPONSE_INVALID`                  |
| Caller aborts                                                                                      | `CANCELLED` (takes priority over timeout) |

`PROVIDER_SHAPE` and `INVALID_MODEL_RESPONSE` mean response validation refused the result; they do **not** establish provider unavailability. Unknown local programming exceptions still fail closed without publishing their details. Engine budgets, no-retry behavior, unknown-outcome reservations, independent pinned evidence and human approval remain intact. Completion and reasoning caps are now explicit checks so cap violations retain their classification instead of disappearing into a shape error.

## Possible contract mismatch, not a proven live cause

The account schema retained from the prior preflight and Cloudflare's [official Gemma schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/gemma-4-26b-a4b-it.json) describe `tool_calls` as an optional array. The baseline accepted only absent/null values. An empty array represents no native tool calls and now passes; nonempty arrays still fail closed. Nullable/empty refusal metadata is harmless, but an actual refusal or legacy function call cannot become an agent decision. The native request still declares no provider tools, and downloaded source is never executed.

No code fences are stripped, no invalid JSON is repaired, and no unsupported decision is coerced into a finding. Mock fixtures reproduce fenced JSON, invalid tool arguments, native-envelope mismatch, excessive tokens, timeout, provider errors, relay corruption and unknown uppercase error codes. A successful empty-tool-array fixture still goes through the existing backend evidence validator. These establish application behavior, not what Gemma returned in the failed live call.

## One bounded live-agent acceptance proposal

**Proposal only; separate explicit authorization required.** After fresh Free/Hobby eligibility, current model-contract and shared-usage checks (at least 2,000 shared Neurons remaining), create one `mubidotjs-prism` Hobby project with one protected acceptance deployment of the verified commit, and one `prism-ai-review` Worker with its existing native Gemma binding/counter-only Durable Object namespace. Use only fixed synthetic GitHub fixtures: **zero live GitHub GETs**, no arbitrary prompts, no production release or changes to Projects 1/2.

Run **one agent workflow**, at most **16 native dispatches / 30 seconds / 2,000 estimated Neurons**, preserving all existing per-call limits, authentication, scoped tools and evidence checks. Start with more than 60 seconds before the UTC daily reset so the workflow cannot cross a counter reset. The allowance is shared with Projects 1 and 2; estimated Neurons are not a provider-enforced per-call quota. Do not repeat transport fixtures, the basic Gemma probe or completed acceptance work. Require at least one independently validated supported synthetic finding and verify the existing human-approval/manual-copy gate.

Capture only the allowlisted error code, adapter attempts/validated-decision counts, bounded budget/coverage metadata, native counter/reservation totals and shared usage observations. Never prompts, PR/source bodies, raw model output, credentials or arbitrary exceptions. On the first failure, stop and report its observed classification/boundary; do not infer a more specific cause than the evidence supports. **No retry, repair call, alternate model/provider or corrective redeployment.** Delete all temporary deployment/namespace/secrets and revoke temporary CLI access regardless of result. A pass establishes the synthetic agent path; a real public-PR production release would still require its own explicit scope.
