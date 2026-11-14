# Single-inference production review

## Production path

`src/server/agent/engine.ts` now performs **capture → prepare evidence → one proposal call → independent validation → partial human-review draft**. Metadata, inventory, pagination, pinned source acquisition and before/after snapshot verification use the existing trusted GitHub backend. None requires an LLM decision. Ingestion still permits at most 12 GitHub requests, 100 inventoried files, six 128-KiB source contexts and the existing byte/time bounds.

The backend prepares a version-4 package containing bounded metadata previews, verified head repository/SHA, current filenames and explicit `{line,text,added}` source coordinates. Source selection uses diff coordinates and generic header/neighbour lines, **never AST risk matching**. It visits all captured eligible sources in inventory order and packs their lines round-robin: at most 80 lines/8 KiB per file, six files, 48 KiB for the complete model request. Oversized or omitted lines are counted as unprovided. No extra upstream request is introduced.

GitHub titles, descriptions, paths and code remain untrusted data under a fixed system policy. No downloaded code is executed. The model cannot request another file, network URL, investigation tool, inference turn, approval or publication. Real release configuration uses the native Workers AI adapter; no deterministic or mocked model result substitutes for a provider response.

The native call retains Gemma's documented function-calling transport, `returnRawResponse: true`, non-streaming output, thinking disabled and the existing 2,048-completion-token bound. It advertises only **`submit_review`** with this minimal parameter shape:

```json
{
  "proposals": [
    { "kind": "nan-comparison", "path": "src/checkout/validate.ts", "line": 2 }
  ]
}
```

The other supported kinds remain `jwt-expiration-disabled` and `tls-verification-disabled`. `proposals: []` explicitly means no supported findings; it never establishes safety. Each proposal contains only kind/path/line. There are no model-authored severities, narratives, evidence IDs or source URLs. One modern native function call may contain up to **six proposals**, preserving the existing 12-tool budget for one create plus one independent validation per proposal. This is an explicit response bound, not a reduction of source acquisition, inventory or deterministic-review limits. Too many proposals or malformed structure fail the complete response rather than being silently truncated.

For each AI-selected hypothesis, Node first requires the exact coordinate to have been supplied as an added line. It invokes existing `BackendEvidence` creation and independent fact-card validation, checking the private pinned source and the same three conservative AST predicates. Only accepted canonical cards become findings. Unsupported, duplicate or unprovided claims are explicitly refused. A failed deadline, cancellation, byte/tool/validation limit or provider error suppresses all findings. There is no repair inference or automatic retry.

The authenticated, digest-bound, one-use human approval gate remains separate from inference. It permits manual-copy Markdown only. The model cannot approve, and PRISM has no GitHub write functionality. Browser-computed findings remain untrusted by Node.

## Coverage and privacy

Results expose metadata totals, inventoried/source-available counts, supported-predicate check counts and the exact line-number sets prepared for the model, without returning omitted source. Context coverage separately records supplied lines, supplied added lines, omitted **known parsed** added lines and `not-sent` / `attempted` / `response-received` dispatch state. Missing/binary/oversized patches can have unknown coordinates; parsed-line counts do not pretend to account for their unavailable content.

Prepared/supplied windows are not an attestation that a model comprehended every line. Unprovided source cannot support findings. Even when no parsed lines are omitted, results remain partial because only bounded context and three predicates are covered. Empty proposals execute no AST finding generation and do not promote deterministic matches. UI/report wording distinguishes prepared context from inspected/comprehensive coverage; the deterministic workspace, offline demo and branding remain intact.

Repository data, model bodies and prompts stay in bounded request memory. Only existing quota/admission counters persist in the Durable Object; drafts remain expiring RAM data. No new storage, framework, queue, paid service or provider fallback is introduced. Historical multi-turn logic is isolated in `legacy-engine.ts` and explicit legacy test seams; production and the isolated acceptance route always use the single-inference path. The old private `/decide` protocol is disabled unless the unit-test-only environment flag is explicitly injected; no Wrangler/deployed configuration supplies it, and callers cannot select it through the Node API.

## Owned timeout-stage diagnostics

No timeout was increased. Native invocation plus response handling still share **18 seconds**; Node relay handling remains **20 seconds**; the logical review/grant remains **30 seconds**, inside the existing 40-second Node platform configuration. Code checks elapsed deadlines as well as abort signals.

| Safe code                     | Observed boundary                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `NODE_RELAY_DEADLINE`         | Node's own relay timer expired while awaiting the relay/its response.                       |
| `NATIVE_INVOCATION_DEADLINE`  | Cloudflare's own native deadline expired before the binding returned.                       |
| `REVIEW_GRANT_EXPIRED`        | The relay grant expired before dispatch, during inference, or before settling its response. |
| `RESPONSE_VALIDATION_TIMEOUT` | The native deadline expired while reading/normalizing/validating the returned response.     |
| `REVIEW_DEADLINE`             | Node's overall review deadline expired, including trusted preparation/validation.           |
| `CANCELLED`                   | The caller cancelled the review.                                                            |

A provider/transport-thrown timeout without an expired owned clock remains generic `PROVIDER_TIMEOUT`; its precise layer is not invented. Existing closed response-shape diagnostics, strict function/argument schemas and token/accounting checks remain. Absent usage retains the entire conservative reservation. Unknown outcomes retain their reservation and lease; they never authorize another attempt. No arbitrary exception text, raw output, source, prompt or credential enters diagnostics.

## Offline verification and live status

The new production tests exercise one native-shaped response selecting all three canonical findings, backend revalidation, authenticated one-use approval, Markdown and actual clipboard copy. They cover malicious comments and benign lookalikes, empty/invalid/duplicate/unsupported hypotheses, omitted/deleted/mismatched source, six-file bounded packing, capture failures, budget exhaustion, cancellation, every owned timeout stage, duplicate invocation rejection across coordinator restarts and the disabled legacy production protocol. The packaged Node HTTP check now asserts one `/propose` call and no extra inference for approval. Historical tests remain explicit historical coverage.

These are synthetic provider responses only. The latest actual multi-turn run on `b47c5f3` ended in `PROVIDER_TIMEOUT`; its precise layer remains unknown because it predates these stage codes. [Preserved live evidence](ai-agent-acceptance-result.json). This correction makes no new live-inference or production-success claim.

Local verification passed: **443 unit/integration tests**, **32 desktop/mobile Playwright tests**, types, ESLint, formatting, frontend/Node builds, Cloudflare dry compilation, mock agent demonstration and isolated acceptance-artifact preparation. Dependency audit: **zero vulnerabilities**. No deployment, model call, account usage check or DNS work occurred. The native contract was checked through public official documentation only.

## One bounded acceptance and release authorization — pending

After publication and passing exact-SHA CI, request approval once for this correction. No prior failed-run scope carries over:

1. Reuse accepted Free/Hobby/Dynadot evidence. Refresh model/native contract, shared Neuron usage and existing-project ownership through supported read-only APIs. No screenshot/usage loop, transport benchmark or basic provider probe. Stop on a concrete eligibility/quota failure.
2. Create one `prism-ai-review` Worker with native `@cf/google/gemma-4-26b-a4b-it` and one counter-only SQLite Durable Object namespace; one `mubidotjs-prism` Vercel Hobby project with at most **two deployments of the exact verified SHA**. Preserve all secrets, access-code protection, origin checks and quota controls. No paid changes or modifications to Projects 1/2.
3. Run one protected synthetic review with **at most one native dispatch and 30 seconds**, zero live GitHub requests. Require a genuine AI-selected supported hypothesis, independent canonical validation, human approval and manual copy. No inference for acquisition, selection confirmation or finalization. Empty proposals are honest but do not satisfy this finding-acceptance criterion.
4. Only on success, stage the normal application and verify one public-PR AI review, plus at most one deterministic ingestion. Combined ceilings: **two workflows, two native dispatches, 1,200 additional estimated shared Neurons and 24 public GitHub GETs**. Current conservative maximum is **529.997 estimated Neurons per full-size call**, below 1,200 for two; estimates are not provider-enforced quotas and share Projects 1/2's allowance. A public PR without supported claims must return none honestly.
5. Only after complete acceptance retain production, expose the frontend/demo while live endpoints remain access-code protected, and connect only `prism.mubashirhussain.dev` using Vercel's exact CNAME/required verification TXT. Provide exact records for manual Dynadot entry if authenticated editing is unavailable. Preserve all existing records. Verify HTTPS, prepared favicon/metadata and desktop/mobile functionality with at most five final checks over 15 minutes and no extra inference.
6. Stop on the first failed criterion with the specific safe category/stage. No retries, repair calls, alternate models or corrective redeployment. Remove all new resources and this run's DNS additions on failure. Remove acceptance/operator resources/secrets and revoke temporary CLI access either way; retain runtime services only after success. No new milestone or speculative infrastructure is authorized.
