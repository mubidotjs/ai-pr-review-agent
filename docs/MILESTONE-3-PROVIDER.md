# M3: one real native Workers AI binding probe

**Binary decision: provider path viable for this isolated synthetic probe.** One deployed native binding invocation returned a nonempty, recognized model response. This does not certify full PRISM deployment, review quality, reliability across requests, or an agent workflow. The M2.5 ingestion CPU blocker remains.

## Preflight before provisioning

On November 13, 2026, the signed-in internal Cloudflare dashboard showed **Workers Free / Current plan / $0**, and **0/10,000 shared Neurons used today**, resetting at 00:00 UTC. The last-24-hour model chart showed 53.01 historical Neurons; this is a different window. Project 3 does not have a separate allowance. The user explicitly authorized this one attempt and its possible effect on the allowance shared with Projects 1 and 2.

The exact model, `@cf/google/gemma-4-26b-a4b-it`, appeared in the account catalog and authenticated model-search API. Both model search and native input/output schema reads returned HTTP 200. Current public pricing includes it in the free allocation and excludes it from the models requiring billing. No paid plan, credits, AI Gateway, vendor credentials or alternate provider was configured.

The request was checked against the **account's current native schema**, not only an OpenAI-compatible endpoint's documentation. It has one user message containing the fixed 34-byte ASCII prompt, `max_completion_tokens: 32`, `stream: false`, `n: 1`, and the documented `chat_template_kwargs.enable_thinking: false`. No tools, schema response format, arbitrary prompt, PR content or agent integration is present. The tiny fixed message is below the conservative 256-input-token envelope; the response subsequently confirmed **24 prompt tokens**.

**Reasoning accounting:** the current native contract describes a completion upper bound but does not explicitly define how reasoning tokens are counted when reasoning is enabled. The same schema explicitly documents disabling reasoning, so this probe sets it to false instead of assuming an undocumented enabled-reasoning accounting rule. A separate reasoning-token count was not returned; do not describe it as a measured zero. A later reasoning-enabled design needs its own contract validation and authorization.

At the published rates of 9,091 input and 27,273 output Neurons per million tokens, the conservative 256-input/32-completion envelope estimates **3.200032 Neurons**, within the authorized **10-Neuron experiment budget**. This is an estimate, **not an enforceable per-call quota**. A timeout can still consume allowance. No second attempt was authorized by any failure or uncertainty.

Before provisioning, read-only settings/deployment metadata fingerprints were captured for `ai-release-notes-generator` and `ai-invoice-receipt-processor`. They were rechecked immediately before upload and after cleanup; both pairs matched exactly. Their source, configuration and deployments were not modified. [Preflight evidence](milestone-3-preflight.json) records only safe model/contract metadata and hashes, without account email, account identifier or credentials.

## Exact deployed experiment

| Property                              | Observed/configured value                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Disposable Worker                     | `prism-m3-provider-probe-20261113`                                                               |
| Version identifier returned by upload | `13bf4af72caa4ed9bbb43f05708d647f`                                                               |
| Invocation window                     | November 13, 2026, 10:24:31–10:24:54 UTC (15:24:31–15:24:54 PKT), including provisioning/cleanup |
| Route                                 | `POST /api/provider-probe` on its temporary `workers.dev` hostname                               |
| Bindings                              | `AI` (native `ai`), random backend-only `PROBE_SECRET`, `PROBE_EXPIRES`                          |
| Compatibility date                    | `2026-11-13`                                                                                     |
| Bundle                                | Approximately 7.80 KiB raw; SHA-256 in the result evidence                                       |
| Logs/traces                           | Disabled                                                                                         |
| Request                               | Exactly `{}`; prompt/configuration exist only in Worker code                                     |
| Client / binding deadline             | 20 / 18 seconds; binding receives an abort signal                                                |
| Inference attempts                    | **One operator POST; one native `AI.run` invocation**                                            |

The Worker is a minimal isolated module: no Hono ingestion, GitHub calls, Babel, review analysis, investigation tools, frontend, database or storage. It invokes the deployed `env.AI.run` path directly, with no `unstable_dev`, remote development binding, SDK wrapper or REST inference substitute.

All routes require the initial-upload secret and expire automatically. Query parameters, browser Origin headers, arbitrary paths, other bodies and caller prompts are rejected. Readiness uses authenticated **GET → 405** checks and never calls the model; the only inference dispatch is reserved in safe local evidence before sending POST. There is no POST retry, alternate model, streaming response or fallback.

A synchronous consumed latch prevents duplicate calls in one isolate, including concurrent requests. It is **not a globally durable replay ledger**. Across isolates, the one-shot operator dispatch, never-exposed random secret, short lifetime and immediate route removal provide the experiment boundary. The script refuses to run once its result file exists. It must never be rerun under this authorization, including after a timeout or interrupted delivery.

## Actual result

- Probe HTTP status: **200**; native provider HTTP status: **200**.
- Binding invocation returned successfully: **yes**, once.
- Verified format: `chat.completion` with one assistant message at `choices[0].message.content`.
- Output: **`PRISM_PROBE_OK`**; finish reason: `stop`.
- Usage returned: **24 prompt / 8 completion / 32 total tokens**. Both requested token ceilings were respected.
- Client-observed inference request latency: **802.665 ms**. This is not CPU time and is not a multi-request reliability percentile.
- Provider request ID: `35d47558-a1f4-47e3-8c5f-d24bc04f9df3`.
- Returned model tag: `@cf/google/gemma-4-26b-a4b-it-external`. This tag is recorded as returned; it does not establish Cloudflare's internal serving implementation. The application requested only the authorized model and configured no alternate model/provider or gateway fallback.

The token-based **uncached cost estimate** for 24/8 tokens is **0.436368 Neurons**. The dashboard initially still showed zero, then updated to **0.44/10,000 Neurons used today**; its last-24-hour chart moved from 53.01 to 53.45. This rounded/delayed shared-account delta is consistent with the estimate, but is not an exact per-call billing ledger and can include concurrent usage. [Account observations](milestone-3-account-observations.json) retain the distinction between time windows. No arbitrary provider exception, unrestricted payload, authorization header, secret or token is saved. Only the fixed synthetic output, recognized response fields, bounded usage counts and safe identifiers are retained in [the result evidence](milestone-3-provider-result.json).

## Cleanup and scope preservation

The route was disabled immediately after result collection: API **200**. The exact temporary Worker was deleted: API **200**. Its settings lookup returned **404** and the public probe URL returned **404**. Deleting the Worker removed its temporary secret and native AI binding; no callable probe remains. The new official Wrangler OAuth session was revoked (`Successfully logged out`), and `whoami --json` returned `loggedIn: false`. The existing browser sign-in was left intact. The dashboard still showed **Workers Free / Current plan / $0** after cleanup.

Project 1/2 before/after settings and deployment fingerprints match. The application under `src/`, dependency lockfile, main Wrangler configuration and CI workflow are unchanged. PRISM still has its offline demo and deterministic browser Worker pipeline, with **AI disabled in the application**. No full application, Vercel resource, custom domain, paid plan, CPU experiment or additional model call was deployed/run in M3.

Mocked tests cover fixed request enforcement, fail-closed auth/expiry, concurrent duplicate rejection, exact one-call parameters, cancellation, bounded response reading, safe error classification and malformed contracts. Tests never invoke a real binding. Local verification passed **158 unit/integration tests, 22 Playwright desktop/mobile tests, types, ESLint, formatting, frontend/backend builds and dependency audit (zero vulnerabilities)**. Existing deterministic finding/coverage parity and browser lifecycle/privacy checks remain green. The application build has the same frontend assets and ingestion boundary as the baseline; the isolated probe is not bundled into it.

## Next decision

Keep provider feasibility separate from ingestion hosting. [The Vercel Hobby Node.js assessment](M3-INGESTION-HOSTING.md) recommends investigating a single Node ingestion function with verified binary response streaming. It identifies an unchanged legal review response larger than 4.5 MB and the current 12-MiB ceiling. No hosting migration, new infrastructure, full agent, persistent replay store, or public launch is implemented or authorized here. Any further inference requires a new explicit budget and authorization.

References: [native model contract](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [raw official model schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/gemma-4-26b-a4b-it.json), [account-native schema API](https://developers.cloudflare.com/api/resources/ai/subresources/models/subresources/schema/methods/get/), [pricing and free allocation](https://developers.cloudflare.com/workers-ai/platform/pricing/), [native binding implementation and abort/raw-response options](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts).
