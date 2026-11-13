# M5: local mock-only agent review engine

**Implemented locally with scripted model responses; not operational with real inference.** No cloud deployment, provider/model call, GitHub write, paid service, credential setup or modification to Projects 1 and 2 occurred. The deterministic React application, browser Web Worker, offline demo, ingestion route and review limits remain intact. Its visible AI state stays disabled.

## Run the complete synthetic workflow

```sh
npm ci
npm run agent:demo
# Optional, from an interactive terminal after reading the draft:
npm run agent:demo -- --approve
```

The demo uses only local fixtures and `ScriptedMockModel`; the GitHub transport is mocked too. It exercises metadata/inventory tools, five pinned source windows, three supported proposals and two deliberately unsupported lookalikes. It reports **3 mock drafts; 8 total/inventoried files; 5 inspected; 3 uninspected; 0 uninventoried**, with **13 scripted decision calls, 12 investigation calls, 8 evidence checks and 9 mocked GitHub requests**. A model-call counter here counts scripted decisions, not inference requests. Real model and live GitHub calls in this demonstration are zero.

The default report says **UNAPPROVED**, **MOCK**, and **no real inference**. `--approve` requires a TTY and a human to type the exact displayed digest. It produces only an approved selection for manual copy. It never posts a comment, submits a review or approves a pull request. No source/report history is written to disk. Ctrl+C cancels an active run.

## State machine and implementation

`src/server/agent/engine.ts` implements:

1. **investigate:** validate the exact public PR URL and acquire backend evidence.
2. **select-read-only-tool:** ask the adapter for one strict JSON decision.
3. **observe:** validate and execute one inventory-scoped tool, then provide an explicitly untrusted observation. Repeat within fixed budgets.
4. **generate-findings:** receive a final structured batch, or an explicit refusal.
5. **validate:** independently check each proposal on the backend, including proposals the model previously asked a tool to validate.
6. **finalize:** return an honest partial/draft/refused/failed/cancelled/disabled result, refusal codes and bounded metadata trace.

The only model transport implementation is `ScriptedMockModel` in `model.ts`. `AgentModelAdapter.next(request, signal)` is a portable versioned JSON interface. Even an adapter declaring `mode: "workers-ai"` is refused before capture or invocation in M5. There is no enabled provider branch, SDK, API key, AI binding, remote URL setting or retry/fallback implementation.

`src/server/agent.ts` exports the new engine/adapter types while retaining the old permanently disabled MVP adapter for compatibility. That old adapter's raw tool types must not be exposed to a model. The running M5 protocol is the strict scoped union in `agent/protocol.ts`.

## Backend authority and tools

The engine accepts **only `{url}`** as review input. Browser snapshots, findings, attestations, model configuration and extra fields are rejected. Transport/model dependencies are trusted backend configuration, not user/model arguments. `BackendEvidence` has a private constructor; its capture factory calls the existing read-only ingestion implementation. It cannot be constructed through the public engine API from a browser's JSON.

Capture reuses the same `GitHubClient` and all original security checks: constructed HTTPS REST GET endpoints, public visibility, pagination, source-context selection, fork/current rename paths, exact head SHA, rate headers, request/byte/time limits and reserved final consistency verification. It checks the existing 12-MiB snapshot framing ceiling. Missing final verification prevents any model invocation; changed snapshots fail cleanly. Source/patch text is never executed or imported.

The model then investigates **cached, backend-owned, verified evidence**. It cannot make additional GitHub requests, choose a repository/SHA/API URL, retrieve a seventh source or reset a budget. This front-loaded acquisition keeps source selection identical to the MVP. It is bounded evidence investigation, not an unrestricted repository browser.

| Tool                    | Arguments and authority                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPullRequest`        | Empty object. Bounded metadata previews with explicit truncation/original byte counts and capture identity.                                       |
| `listChangedFiles`      | Inventory offset and 1–5 files; statuses/counts, first added location and source availability. No caller URL or arbitrary API page.               |
| `readFileContext`       | Inventoried current path and inclusive 1–80-line window. Exact pinned source lines, head SHA and added-line flags; output capped at 8 KiB.        |
| `createReviewFinding`   | Supported claim kind, path, line, exact evidence. In-memory fact-card construction after backend validation; no publication or external mutation. |
| `validateReviewFinding` | One structured fact card. Revalidates backend evidence; its response cannot replace final validation.                                             |

Oversized observations are refused, not silently truncated or marked inspected. A very long single line may therefore be unavailable to the agent even though the unchanged deterministic browser engine can review the file. Metadata previews are explicitly labeled previews; source evidence is never cut to make a finding fit. All six originally eligible source slots remain available under the existing acquisition rules.

## Structured claims and conservative semantic validation

A candidate carries `kind`, severity, title, explanation, recommendation, path, one-based new-side line, exact source evidence, canonical source URL and a run-bound evidence ID. Accepted output is explicitly `source: "mock-model"`, `ai.mode: "mock-only"`, `realInference: false` and `evidenceValidation: "backend-pinned-supported-predicate"`. It is not mixed into the deterministic UI or represented as a real AI response.

M5's supported semantic profile is deliberately closed to the existing **NaN comparison**, **recognized Node HTTPS Agent TLS opt-out**, and **recognized jsonwebtoken expiration opt-out** categories. Models may select hypotheses and investigation steps; they cannot certify arbitrary natural-language vulnerability claims merely by quoting a real line.

Fact-card validation independently reruns the existing pure Babel/binding-aware rules **on the backend's own pinned source and parsed diff**, not browser findings. It requires:

- A real inventoried supported file with verified source repository, path and SHA.
- A line actually observed through the backend context tool.
- Exact equality between candidate evidence, an **added** diff row and the pinned source line.
- Agreement between **every available new-side diff row** and pinned source, including rows outside the proposed finding.
- A supported AST predicate with conservative import/shadowing/option recognition; comments, strings and ambiguous bindings are not proof.
- A canonical source link, severity and factual explanation/recommendation, with a run/capture/head-bound evidence digest.

The model receives a canonical fact card for a supported hypothesis. Final generation must return those supported fields exactly. Invented severity, changed recommendations, exploit claims, fabricated evidence/locations/URLs, duplicates and fact cards from another run are refused explicitly. Source links and narratives are backend-owned; the model cannot add unsupported prose to a validated quote. Novel bug kinds need additional validation rules or a separately designed unverified-hypothesis workflow; they are not silently accepted in M5.

The validator **does not generate the agent's final findings automatically**. If the model proposes no findings, none are returned even when deterministic checks match. Canonical narratives come from the validator's supported facts; the agent proposes their selection. This is mock workflow verification, not evidence of language-model reasoning quality or general code-review ability.

## Budgets and cancellation

All original review limits remain: 12 total GitHub requests including final capture verification, 100 inventoried files in two 50-file pages, six source files, 128-KiB patch/source limits, 2/8-MiB individual/aggregate upstream limits, 8-second upstream timeout, 10,000 diff lines, 100 findings and the 12-MiB capture ceiling.

Additional agent caps are independently enforced:

| Resource                                  |            Maximum |
| ----------------------------------------- | -----------------: |
| Whole local agent run, including capture  |         30 seconds |
| Decision steps / scripted adapter calls   |            16 / 16 |
| Investigation tool calls                  |                 12 |
| Model input / output per turn             |        48 / 32 KiB |
| Tool observation / aggregate observations |         8 / 96 KiB |
| Evidence checks / final findings          |          100 / 100 |
| Result / Markdown export                  |    512 KiB / 1 MiB |
| Human selection lifetime                  | 5 minutes, one use |

The model sees the last three bounded observations plus the bounded board of fact cards it requested. Complete input size is checked before every turn. Old observations remain counted in the aggregate budget; fact cards do not cause automatic findings. Runtime limit overrides may only reduce caps; unknown/increased limits are rejected. Result-overflow failures return a compact envelope with no findings and **unknown** coverage. Rate-limit reset/cooldown metadata is preserved, without retries.

Abort signals cover capture, tool boundaries and adapter waits. A deadline/cancellation race settles even when a mock adapter ignores its signal. Late completion cannot update a cancelled result or unlock approval. Terminal errors/limits suppress findings; unverified captures never reach the model. Synchronous bounded diff/Babel validation is checked before and after execution; it is not a preemptive CPU sandbox or exact heap quota. Heavy validation is isolated to the local Node agent, never added to the lightweight ingestion bundle or Cloudflare AI execution path.

## Coverage, privacy and approval

Agent coverage is distinct from deterministic coverage. It reports metadata total, inventoried, source-available, files with inspected windows, files whose supported predicates were checked, uninspected and uninventoried counts, plus per-file reasons. Inspected does not mean the whole file was analyzed. Missing capture means coverage is unknown. Zero proposals never means security clearance.

Repository metadata, comments, paths, source and tool observations enter a separate `UNTRUSTED_REPOSITORY_DATA` channel. They never change the fixed system policy, tool catalog, adapter, budgets or approval state. Model JSON is byte-bounded before parsing, strictly validated and never evaluated. Unknown tools/arguments, write attempts, approval commands and attestation flags are refused. Mock adversarial tests verify host enforcement; they do **not** establish that a real model will resist prompt injection.

The returned result DTO is not a signed attestation. The human gate privately retains the canonical result, requires an exact run/digest and explicit selected IDs, rejects stale/replayed decisions and does not accept changed finding bodies. Mutating a returned DTO cannot alter approved content. This is a local trusted-human interface, not authenticated identity infrastructure. External consumers must never trust a browser's `evidenceValidation`, digest, source label or approval flag; future server endpoints must reacquire/validate trusted evidence and bind authorization to an authenticated human session.

Only in-memory observations, canonical drafts and bounded traces are used. No PR persistence, analytics, accounts, shell/eval capability, GitHub write permission or publisher exists. Markdown escapes untrusted text and fence/HTML breakout attempts. Human approval only unlocks **manual-copy output**, not a network action. Snapshot verification describes the captured SHA, not a guarantee that the PR remains unchanged minutes later; any future publication capability would need fresh head/evidence checks and separately authorized write access.

## Compatibility and remaining enablement work

The browser Worker, React files, deterministic rules, demo input and `/api/review` contract are unchanged. Build guards reject agent/AST/report modules in both ingestion bundles. Node orchestration/evidence authority remains separate from an eventual Cloudflare model transport. A future Cloudflare service would receive bounded untrusted JSON observations, return one decision, and own **no GitHub investigation or publication capability**.

Before real AI can be enabled, separately authorize and implement the disabled remote adapter, confirm current account/model Free eligibility and shared Neuron availability (including possible impact on Projects 1 and 2), and verify the actual authenticated Node-to-Cloudflare decision path and response contract with an explicit small inference budget, strict timeout and no retries/paid fallback. M3's one native binding response does not verify this multi-turn JSON workflow. Keep the current real-model guard closed until that separate verification passes.

Public hosting, multi-instance abuse/quota controls, authenticated human approval and Vercel end-to-end transport acceptance remain separate launch requirements. M4.5's unverified result is not reopened in M5. No complete public agent or production rollout is implied.

## Verification

The release suite contains **246 unit/integration tests**, including **61 agent-specific cases**, plus **26 Playwright desktop/mobile checks**. Agent cases cover the complete tool loop, all supported claims, false positives, malicious metadata/comments, strict schemas and SSRF attempts, pinned source mismatch, renamed/forked source, unavailable context, changed/unverified snapshots, 100-file/six-source coverage, quota exhaustion, every agent budget, UTF-8 byte limits, safe errors, cancellation/late replies, canonical approval/digest/replay/expiry and Markdown sanitization. The existing frozen deterministic findings/coverage oracle remains unchanged.

`npm run check` runs types, ESLint, formatting, unit/integration tests and both frontend/backend build paths. `npm run test:e2e` verifies the preserved UI through local Node HTTP. The dependency audit has zero vulnerabilities. CI additionally runs `agent:demo` using synthetic data and no real network/model requests. Build-time source-map checks keep the agent, Babel, analysis and report code out of ingestion. No deployment step was added.
