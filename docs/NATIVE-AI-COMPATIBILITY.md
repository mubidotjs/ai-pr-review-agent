# Native Gemma response compatibility and safe diagnostics

## What the documented contract actually says

Reviewed November 14, 2026, without account access or inference. Cloudflare's [binding implementation](https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts) documents `returnRawResponse: true` and returns the native fetch `Response` before automatic JSON/body handling. It does not select the separately documented [OpenAI-compatible `/v1/chat/completions` endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/). PRISM continues using `env.AI.run` with the native binding, its existing model parameters and abort signal; there is no REST inference substitute.

The [Gemma-specific schema](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/workers-ai-models/gemma-4-26b-a4b-it.json) nevertheless defines synchronous JSON as a completion object with `choices[].message`. Its function arguments are JSON **strings**, and assistant `content` can be a string or null alongside `tool_calls`. Usage is optional at the envelope level. This model's contract does not justify accepting another model's flat `{response, tool_calls}` layout, object-valued function arguments, a REST `{result: ...}` wrapper or arbitrary JSON as a decision. Streaming is a distinct schema branch; PRISM requests non-streaming output.

The official public schema's serialized `schema` SHA-256 is `6ddfbdfeec740b2d74faf7d2311262945f1b4bb3ca1b55258c823f69b56605d4`, matching the previously captured account-native schema. Downloaded binding-source SHA-256: `166cb9e34356b6259384c6a0d06fd7e54eccde1d4138079fdf4d7da960965e33`. These are reference hashes, not evidence of a new provider call.

## Every previous PROVIDER_SHAPE source

At tested commit `fddaf0a`, three sites in `src/release/cloudflare.ts` collapsed the following conditions into the same code:

| Site                            | Conditions                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native return                   | The binding did not return a `Response`.                                                                                                                                                                                                                               |
| Body collection/decoding        | Missing body; the 64-KiB limit; invalid UTF-8 or JSON; other non-timeout stream/read errors.                                                                                                                                                                           |
| Envelope schema                 | Non-object envelope; wrong/missing `object: chat.completion`; choices not an array of exactly one; choice not an object; finish reason other than `stop`/`tool_calls`; missing/non-object message; role other than assistant.                                          |
| Assistant fields in that schema | Any **nonempty content string**, non-string/non-null content, nonempty or wrongly typed refusal/reasoning content, or a non-null legacy `function_call`.                                                                                                               |
| Function fields in that schema  | Missing/null/non-array tool calls or count other than one; non-object call/function; missing/non-string/empty/overlong call ID or name; call type other than function; arguments missing, non-string or over 64 KiB characters. ID/name bounds were 256/64 characters. |
| Usage fields in that schema     | Missing/non-object usage; missing/non-integer/negative prompt or completion counts; malformed optional completion details or reasoning count.                                                                                                                          |

Length termination and over-bound prompt/completion/reasoning counts already had `PROVIDER_TOKEN_BOUND`. Oversized argument bytes, malformed argument JSON, unsupported actions and invalid tool arguments had their own existing codes. HTTP failures/quota responses and timeouts were separate. Unknown metadata was ignored.

Before this correction, the live failure was dispatch three on `fddaf0a`, before source inspection. Raw output was deliberately not retained, so its specific rejected condition remains **unknown**. The documented nonempty-content and absent-usage mismatches are demonstrated offline; neither is claimed as the proven cause of that live failure. [Archived safe live evidence](ai-agent-acceptance-fddaf0a-result.json).

## Focused normalization and diagnostics

`src/release/native-response.ts` now owns bounded reading and the existing single native function decision boundary. It accepts documented accompanying assistant prose and discards it entirely: prose never becomes a tool argument, observation, finding or instruction. Exactly one modern function call is still required, with a valid ID, allowed function name and string arguments. Existing argument JSON/schema, current-tool allowlists, time/step/request budgets, supported predicates, pinned-source/added-line checks and human approval remain intact. Legacy/custom/parallel calls, refusals and unsolicited reasoning remain outside the requested workflow and fail closed.

Optional **absent** usage retains the entire pre-dispatch conservative Neuron reservation. It is not settled as zero, estimated as actual usage or refunded. A validated completed response can release its active lease; its retained reservation still counts against the shared cap. Present malformed usage fails closed; present over-bound counts retain `PROVIDER_TOKEN_BOUND`. Configured token limits, non-streaming operation, wire/argument byte limits and no-retry behavior are unchanged. Without usage, actual token consumption is unmeasured, not certified from an estimate.

The reader requires JSON media type (including normal charset parameters), caps actual bytes at 64 KiB, decodes UTF-8 fatally, distinguishes read/JSON/UTF-8 failures and cancels bounded or interrupted streams. Native timeout remains `PROVIDER_TIMEOUT`; HTTP quota/failure remain separate from response validation. The normalized result contains only the selected function name, argument string and validated usage when supplied; unneeded response fields are not forwarded or persisted.

`PROVIDER_SHAPE` now includes one optional diagnostic with a **closed, versioned schema**:

```json
{
  "version": 1,
  "stage": "field",
  "field": "tool_call.function.arguments",
  "issue": "type",
  "received": "object"
}
```

Stages distinguish native return, body, envelope and structural field. Fields, issues and received types are fixed enums; body diagnostics can include HTTP status and a byte count capped at 65,537. No provider value, arbitrary property/key/path, Zod issue text, exception message, body, prompt, source, credential or output hash enters diagnostics. There is at most one diagnostic per terminal failure, below 256 JSON bytes for the supported vocabulary. Node validates this schema again, drops unrecognized/extra diagnostic fields, and retains the safe classification through relay → adapter → engine → Node HTTP result. It is not evidence attestation. No diagnostic/payload is written to Durable Object storage, analytics or unrestricted logs.

The existing selected-validation finalization branch, agent architecture, deterministic UI, offline demo, prepared branding and domain configuration are unchanged. Errors still suppress findings and cannot become successful drafts.

## Offline verification

Synthetic fixtures cover documented completion envelopes with null/empty/nonempty content, nullable auxiliary fields, optional usage and normal JSON media type. Negative cases exercise native return types, body/UTF-8/JSON/media/size/read failures, consumed/locked streams, envelope and individual structural fields, multiple/custom/legacy calls, refusals, reasoning, token/argument bounds and cancellation. No raw response snapshot is stored.

Mock binding integration runs the five investigation/selection decisions with nonempty accompanying prose, independently validates one finding and exercises authenticated human approval without dispatch six. Other tests carry a specific structural diagnostic through the actual local Node HTTP route, reject diagnostic injection, verify counter-only persistence and prove missing-usage reservations still prevent dispatch beyond the shared cap. Existing finding/coverage parity and full browser checks remain required. No deployed or real-inference success is claimed by these tests.

Local verification passed: **414 unit/integration tests**, **32 desktop/mobile Playwright tests**, types, ESLint, formatting, frontend/Node builds, Cloudflare dry compilation, mock agent demonstration and isolated acceptance-artifact preparation. Dependency audit: **zero vulnerabilities**. The unchanged full mock workflow retains its three canonical findings and coverage. No deployment, account/usage/DNS work or inference occurred in this correction; external reads were limited to public official contract references and repository publication/CI.

## Bounded acceptance and release scope — authorized and consumed

The user authorized this scope for `b47c5f31e31ea8734ba6293269ea98432f283cd0` after [exact-SHA CI passed](https://github.com/mubidotjs/ai-pr-review-agent/actions/runs/43595143698). It was consumed by the failure below; there is no permission for another call, corrective deployment or retry.

1. Reuse accepted Free/Hobby/Dynadot evidence and keep historical usage labeled historical. Refresh only model availability/native contract, shared Neuron quota and existing-project ownership/configuration through supported read-only APIs. No usage-screenshot gate, repeated transport benchmarks or basic Gemma probe. Stop on a concrete eligibility/quota failure.
2. Create one `prism-ai-review` Cloudflare Worker with native `@cf/google/gemma-4-26b-a4b-it` binding and one counter-only SQLite Durable Object namespace; one `mubidotjs-prism` Vercel Hobby project with **at most two deployments of the same corrected, CI-verified SHA**. Preserve backend-only secrets, access-code protection, same-origin checks, atomic admission, Node 24, 40-second platform and 30-second review limits. No paid changes or modifications to Projects 1/2.
3. Run **one** protected synthetic real-AI workflow, **at most 16 native dispatches/30 seconds and zero live GitHub requests**, requiring actual source investigation, a supported hypothesis, explicit issued-card selection/validation, independent backend revalidation, and authenticated human approval/manual copy. An accepted validation must cause no extra finalization dispatch. Capture only safe diagnostics and counts; never raw output. Stop on the first failed criterion with its specific diagnostic. No retry, repair inference, fallback or corrective deployment.
4. Only after synthetic success, use deployment two for the full app and verify **one public-PR AI review**, plus at most one deterministic ingestion. Combined caps: **two workflows, 32 dispatches, 2,000 additional estimated shared Neurons and 24 public GitHub GETs**, preserving all per-review limits. Neuron estimates are not provider-enforced per-call quotas and share allowance with Projects 1/2. A real PR without supported claims must finish/refuse honestly.
5. Only on complete acceptance retain production, expose the frontend/demo with live endpoints access-code protected, and attach only `prism.mubashirhussain.dev` using Vercel's exact generated CNAME/required TXT. Supply exact records for manual Dynadot entry if authenticated editing is unavailable; preserve all existing records. Verify HTTPS, prepared favicon/metadata, desktop/mobile and same-origin UI with at most five final checks over 15 minutes, without more inference.
6. Remove acceptance/operator resources and secrets and revoke temporary CLI authorization. On failure remove every newly created resource and only this run's DNS additions, verify cleanup and unchanged Projects 1/2, and report the concrete boundary. No automatic subsequent experiment, public launch after failed acceptance or new infrastructure.

## Executed acceptance result on b47c5f3

**FAIL — `PROVIDER_TIMEOUT` on dispatch four.** Three validated native Gemma decisions executed `getPullRequest`, `listChangedFiles` and `readFileContext`. No hypothesis or fact card was accepted. The engine ended after **22,020 ms**, within the **30,000-ms review deadline**; client time including CLI was **26,798 ms**. The configured native/relay decision bounds are 18/20 seconds. The returned safe category does not establish which native, relay or recognized abort/timeout branch produced it, and no provider receipt/raw output exists for the timed-out attempt. Do not label this a response-shape failure or assert an unmeasured provider-side cause.

There were **four dispatch attempts, three validated responses, zero evidence checks and zero final findings**. `PROVIDER_SHAPE` did not occur in the accepted responses; that limited observation does not establish general provider compatibility or identify the prior defect. Nine GitHub reads were mocked; **zero live GitHub requests** occurred. Human approval/manual copy, the public-PR workflow, normal production and DNS were not reached. The operator stopped immediately without any retry, repair inference, alternate model or corrective deployment.

Worker version `bb77f323-5540-4d5c-94fc-6ec8d6a9246a`, namespace `a8ca773527d249489a6c6a66b586426c`, Vercel deployment `dpl_DLszt3LiJbSgomhMytfBkg6mjML5` and project `prj_llvnOtM5fceQ0pGRXY3AOxpKinIt` were deleted. API reads confirm absence; former Vercel/Worker URLs return **410/404**. Temporary CLI authorization was revoked (`loggedIn: false`), local secrets and this run's Wrangler logs removed, and unrelated-project fingerprints, including Projects 1/2, match. No DNS record changed. [Safe result and cleanup evidence](ai-agent-acceptance-result.json).

Observed daily account usage moved **382.10 → 399.03 / 10,000 Neurons**. These potentially delayed shared observations are not exact per-call receipts. The coordinator retained **207.649 estimated Neurons**, including the timed-out attempt's unknown-outcome reservation; this is not billed usage or a provider-enforced per-call quota.

The concrete blocker is accepting the next native model decision within the existing bounds after source investigation. Offline compatibility, independent validation and approval/copy tests pass; a completed real-AI review and production release remain unverified. The approved scope is consumed. No further experiment or new architecture is proposed by this report.
