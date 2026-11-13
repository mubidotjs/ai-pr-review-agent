# Milestone 2: CPU architecture decision and measurements

Historical local M2 report. [M2.5 subsequently measured actual platform CPU](MILESTONE-2.5-CPU.md) and failed the full-workload Free gate. Its temporary fixture deployment was removed. The measurements below remain unchanged; their pending on-platform gate is superseded by that result.

**Selected:** dedicated browser Web Worker analysis plus one bounded read-only ingestion request. No multi-request distributed analysis, database, queue, paid plan, deployment, or inference was introduced.

The backend no longer imports Babel, constructs findings, materializes diff rows, or generates Markdown. A build-time module-graph guard verifies the boundary. The only retained diff work is a bounded count/coordinate eligibility scan so malformed patches do not steal any of the six source slots. Findings and coverage match the frozen Milestone 1 fixture.

## Before and after

Host: Windows x64, Intel i7-6600U, Node 24.22.1. Browser: Chromium 158.0.8127.18. Local workerd/Wrangler versions are locked in the repository. Measurements are synthetic and local; none are authoritative deployed Cloudflare invocation CPU.

| Measurement                                                          | Milestone 1                | Milestone 2                                   |
| -------------------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| Backend bundle, approximately                                        | 711 KB raw                 | 250 KB raw                                    |
| Backend Babel/AST/rules/report execution                             | Included                   | Absent; build-guarded                         |
| Six ~128-KiB TS, local workerd attributed warm samples               | 150.79–193.25 ms           | 8.37–16.70 ms                                 |
| Six ~128-KiB TS, Node process CPU warm p95                           | 187 ms (analysis pipeline) | 4.8 ms (batched ingestion/transport estimate) |
| Browser Worker TS analysis, six ~128-KiB sources, warm median / p95  | Not applicable             | 126.1 / 174.8 ms                              |
| Browser Worker TSX analysis, six ~128-KiB sources, warm median / p95 | Not applicable             | 312.5 / 322.8 ms                              |
| Identical 6,001-line UI review, main-thread task time                | 701.1 ms                   | 114.4 ms                                      |
| Same UI review, rendered rows                                        | 6,002                      | 200 per page; every row retained              |
| Same UI review, observed long tasks                                  | 113 ms                     | None observed                                 |

The Node before/after measurements intentionally cover different execution responsibilities, not a controlled same-function speedup: AST work has moved to the browser. Node process CPU includes other V8/GC threads and coarse Windows accounting. Its batched estimate can disagree with workerd samples; do not use the favorable TS number to claim that every scenario fits 10 ms.

The direct UI comparison used the actual built verified baseline exported into ignored artifacts. It is a single diagnostic run per version, includes automation/form/selector/render/layout work, and is not a population percentile. The baseline already kept ASTs off the UI thread; the measured UI improvement comes chiefly from bounded row rendering and moving snapshot parsing/report generation into the Worker.

## Browser responsiveness, transfer, startup, and memory

The benchmark covers JS, TS, and TSX at ~16/64/128 KiB, one/six source files, a six-file large diff, and bounded deeply nested expressions. It records first-call/cold and five warm samples after two first/warmup runs. Production creates a fresh Worker per review; warm reuse is diagnostic only.

- Six ~128-KiB TS: 5 ms main-thread heartbeat observed maximum 6.0 ms while analysis ran. TSX maximum 7.1 ms; nested-expression maximum 9.7 ms. No long task was observed in those off-thread batches.
- TS transferred-buffer posting blocked the main thread at most ~0.1 ms; the separate structured-clone run blocked ~0.8 ms. Warm input delivery p95 ~0.3 ms and result delivery p95 ~0.3 ms. Large-diff output delivery p95 ~3.7 ms.
- Production fetches and decodes input in the Worker. Large snapshot JSON encoding in the benchmark's main-thread setup is **not** the production path. Transfer/clone trials compare boundary costs separately.
- Worker bundle in the measurement build: approximately 410 KB raw and 107 KB gzip-equivalent (exact sizes are in the raw report). The preview may serve raw bytes; gzip size is a size estimate, not a claim about configured compression. Warm-cache Worker-ready time in the TS/TSX scenarios was ~61–62 ms; startup samples include scheduling and module initialization.
- TS JS heap point: ~35.1 MB after the batch, ~2.0 MB after explicit GC. TSX reserved JS heap capacity was ~86.5 MB at a sampled point; used heap after explicit GC was ~2.1 MB. These are inspector heap observations, not peak RSS, a hard memory guarantee, or evidence that every device behaves similarly.
- A CPU-bound nested case had a measured terminate-call time below the clock's displayed resolution; the Worker target disappeared within ~241 ms in that diagnostic run. Browser tests also require termination and successful recovery. Target disappearance does not prove immediate OS memory reclamation.

Raw data: [browser](milestone-2-browser-results.json), [UI and cancellation](milestone-2-ui-responsiveness.json), [local workerd](milestone-2-backend-profile.json), [batched Node ingestion](milestone-2-ingestion-node.json). Historical [Node](benchmark-results.json) and [Worker](worker-profile-results.json) data remain unchanged.

## Remaining Free-tier risk and deployment gate

Cloudflare documents [10 ms CPU per Workers Free HTTP invocation](https://developers.cloudflare.com/workers/platform/limits/). Network wall time is separate. Local V8 sampling requests 100 µs intervals, misses short work, has profiler overhead, and includes synthetic upstream Response construction. Node batches amortize coarse CPU accounting and include mock JSON/response creation. Neither instrument measures deployed billing/enforcement.

The split removes the large AST workload and substantially reduces backend cost, but local tails still exceed 10 ms. The framed transport reduced large source JSON escaping/encoding; it does not remove large upstream JSON parsing, eligibility scans, source UTF-8 processing, native transport, or cold/runtime overhead. Six-file TSX/nested/large-diff Node estimates also have tails above 10 ms. Do not silently lower file/source limits or label partially reviewed files complete to pass a timing target.

**Remaining deployment blocker:** full-limit ingestion needs authoritative on-platform CPU validation under separately authorized deployment, especially large patches/pages and cold/tail cases. This milestone does not declare the entire application Workers Free compliant. If that later test fails, keep the same browser architecture and propose a verified free Node-compatible ingestion host before changing infrastructure; do not add distributed analysis or upgrade plans.

## Reproduce

```sh
npm run build
npm run preview
# Other terminal, run separately to reduce host contention:
npm run benchmark:browser
npm run benchmark:ingestion
```

For the actual local Worker profile:

```sh
npx wrangler dev --local --config wrangler.test.jsonc --port 8787 --inspector-port 9229
# Other terminal:
npm run benchmark:worker
```

For the historical UI comparison, export the known baseline into `artifacts/milestone-1` with `git archive`/`tar` (never a second repository), build it using existing parent dependencies, and run `npm --prefix artifacts/milestone-1 run preview -- --port 4175` alongside the current preview on 4173. Then `npm run benchmark:ui`. The baseline export is ignored, unmodified repository content and creates no cloud resource.
