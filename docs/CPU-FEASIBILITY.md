# CPU feasibility: local functionality, production gate

**Result: the current deterministic pipeline is not established as suitable for a single Workers Free invocation. Do not deploy it under that assumption.** Full six-file analysis remains working locally.

Cloudflare documents a **10 ms CPU limit per Free HTTP invocation**, distinct from network waiting and wall time. The application's 30-second wall-time timeout provides no CPU entitlement. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Measurement

Measurements were taken on November 13, 2026, on Windows x64, Intel Core i7-6600U at 2.60 GHz, Node 24.22.1 / V8 13.6.233.17-node.58. Exact runtime details, raw samples summarized as median/p95/max, and timestamps are in [Node results](benchmark-results.json) and [local Worker results](worker-profile-results.json).

`npm run benchmark` measures diff parsing, Babel parsing, binding checks/rules, exact evidence validation, and JSON serialization. Source generation is outside the timed interval. It includes JS, TS, and TSX at approximately 16/64/128 KiB; one and six files; a six-file 64-KiB full-addition diff; and bounded deeply parenthesized expressions. Source bytes remain below 128 KiB. Most scenarios use a small insertion and a realistically larger full head source, matching the actual context workload.

Each scenario has three fresh-process first-call samples, five warmups, and 30 warm samples. CPU uses `process.cpuUsage()` user+system; elapsed time uses `hrtime.bigint()`. Fresh-process samples exclude imports/process startup and are **not** Worker cold-start measurements. Three cold samples give a diagnostic maximum, not a statistically robust tail estimate.

Windows process CPU accounting is coarse and includes V8/GC/background threads. Some samples report 0 ms despite nonzero elapsed time, or CPU greater than wall time. Do not interpret these as precise sub-10-ms measurements or compare them directly with Cloudflare billing/enforcement. Warm p95 >5 ms or any measured CPU >10 ms flags adjustment; these are conservative investigation thresholds.

| Workload               | Warm Node CPU median / p95 / max | Warm elapsed p95 |
| ---------------------- | -------------------------------- | ---------------- |
| 1 × ~16 KiB TS         | 0 / 62 / 63 ms                   | 9.70 ms          |
| 1 × ~128 KiB TS        | 16 / 62 / 62 ms                  | 27.19 ms         |
| 6 × ~128 KiB JS        | 110 / 141 / 172 ms               | 136.79 ms        |
| 6 × ~128 KiB TS        | 140 / 187 / 187 ms               | 164.09 ms        |
| 6 × ~128 KiB TSX       | 468 / 625 / 641 ms               | 426.62 ms        |
| 6 × ~128 KiB nested TS | 187 / 312 / 344 ms               | 399.78 ms        |

## Actual local Worker path

The separate local-only fixture harness executes the same Hono `/api/review` route and real pipeline inside workerd. Upstream responses are synthetic; no cloud or GitHub requests occur during profiling.

```sh
npx wrangler dev --local --config wrangler.test.jsonc --port 8787 --inspector-port 9229
# In another terminal:
npm run benchmark:worker
```

The script captures five sequential runs per scenario through the local V8 inspector, requesting 100 µs sampling. It saves diagnostic `.cpuprofile` artifacts and a committed summary. Attributed sample time excludes idle/program/root leaf frames; it is not authoritative invocation CPU and may include profiler overhead or miss short work. Profiles span profiler start/stop, so their interval differs from the external HTTP timer.

- Small eight-file demo: five sources analyzed; warm attributed samples approximately **16.34–19.98 ms**. First run approximately **82.47 ms**.
- Six ~128-KiB TS sources: six sources analyzed; warm attributed samples approximately **150.79–193.25 ms**. First run approximately **301.88 ms**.
- All large local runs completed and retained six real added-line findings, with ten synthetic upstream requests per review.

These observations support a feasibility warning, not an exact prediction of deployed Cloudflare CPU. No deployment was performed and no Free-tier compatibility is claimed.

## Proposed adjustment before deployment

Keep this milestone's full local functionality and limits intact. Do not silently truncate source and label analysis complete.

For a future Worker-only experiment, propose **one supported source file per compute invocation**, initially capped at **16 KiB source, 8 KiB patch, and 500 diff lines**, with no more than six file steps per logical review. Separate inventory, file work, and final snapshot verification; retain the **12 GitHub requests across the entire logical review**, not per step. Server-issued expiring snapshot capabilities would need to bind repository, SHAs, allowed paths, counters, and evidence; client-supplied counters are insufficient. Skipped files and rejected replays must remain explicit. This protocol is a proposal, not implemented infrastructure.

Even the smaller measured cases do **not** establish enough CPU headroom. Benchmark the proposed per-file transport/JSON/validation overhead and optimize traversal before accepting it. If it cannot satisfy the Free CPU budget, retain local execution and separately agree a different free compute path for deterministic parsing, such as a browser Web Worker or a verified Node-compatible free host. Backend investigation authority and evidence validation must remain enforced. Do not enable a paid plan, add distributed services, or deploy to discover the failure.

Any later deployment experiment needs separate authorization and authoritative invocation measurements. The full six-file/128-KiB single-invocation design is currently blocked from being described as Workers Free ready.
