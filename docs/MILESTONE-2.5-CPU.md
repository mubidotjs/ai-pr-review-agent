# Milestone 2.5: actual Workers Free CPU verification

**Result: FAIL for the intended full workload. No production launch.** The browser Worker split remains useful, but actual platform CPU exceeds the account's 10 ms Free invocation allowance. Successful HTTP responses did not establish reliable headroom. No application code, limits, rules, coverage, or UI were changed.

## Account and isolation

On November 13, 2026, the signed-in Cloudflare account showed Workers **Free**, **$0**, **Current plan**, and **10 ms CPU per request**, both before the experiment and after cleanup. No billing, plan, DNS, Vercel, AI, or other-project configuration changed.

One disposable Worker, `prism-m25-cpu-verification-20261113`, was uploaded once through the official API after the user approved a narrowly scoped official Wrangler OAuth session in the internal browser. Version identifier: `4ae33142aafe4450893ca15c35d761c3`. The deployed bundle's SHA-256 is recorded in [the sanitized evidence](milestone-2.5-platform-cpu.json). The tested ingestion implementation is baseline `2935065c2fe505eb9b5b74fde12fdfd69fc7b740`; only the synthetic test wrapper was new.

The wrapper installs a backend-only random 256-bit secret in the initial upload. Every route fails closed without it. It accepts only authenticated `POST /api/review` requests and ten fixed fixture selectors, expires after one hour, and caps accepted requests at 200 per isolate. The client made a fixed **80 sequential scenario requests plus one unauthorized rejection check**, with 1.6-second gaps, no concurrent requests and no extra invocation retries. A per-isolate cap is defense in depth, not an account-wide counter; the client bound was the experiment's total bound.

All GitHub responses were synthetic, encoded at module initialization. The actual Hono ingestion, GitHub response validation, request budgets, source selection, snapshot checks, UTF-8 processing and framing executed unchanged. The transport cannot contact GitHub or arbitrary URLs. There were no repository credentials or downloaded-code execution. Six contexts and 12-request ceilings remained intact. Logs and traces were **disabled**; only allowlisted platform metrics and client status/count/timing metadata were retained. No request headers, secrets, bodies, reviewed source or unrestricted runtime logs were saved in evidence. Fixtures are committed synthetic test assets, not collected repository content.

## Measurements

Invocation window: **07:53:00–07:55:19 UTC**. Platform data came from Cloudflare's `workersInvocationsAdaptive` GraphQL dataset, filtered to the exact disposable script and time window. Read-only schema introspection confirmed CPU, wall and startup fields are **microseconds**; tables below convert to milliseconds. This is actual platform telemetry, not Node CPU accounting or inspector samples.

The dataset returned **53 timestamp/status groups**, with an estimated request sum of **71**. It is adaptive analytics, **not an exact invocation ledger**. Six bounded metadata reads, 30 seconds apart, returned the same totals. Do not interpret estimated weights of two as two separately measured invocations or fill missing CPU values from client elapsed time. Correlation uses exact UTC seconds from a safe response timestamp. The unrounded platform fields and every client attempt are preserved; [the derived summary](milestone-2.5-cpu-summary.json) explains its calculation.

| Fixture                                  | Client attempts / expected outcome       | Matched platform groups | Observed warm CPU min / median / max (ms) |
| ---------------------------------------- | ---------------------------------------- | ----------------------: | ----------------------------------------- |
| 1 source around 16 KiB                   | 8 × HTTP 200                             |                       6 | 2.396 / 3.062 / 3.676                     |
| 4 sources around 16 KiB                  | 8 × HTTP 200                             |                       5 | 2.857 / 4.436 / 9.855                     |
| 6 sources around 16 KiB                  | 8 × HTTP 200                             |                       5 | 4.327 / 4.700 / 7.497                     |
| 6 sources near 128 KiB                   | 7 × HTTP 200; 1 initial HTTP 404         |      5 (1 cold, 4 warm) | **11.295 / 12.252 / 17.322**              |
| 6 full patches/sources around 64 KiB     | 8 × HTTP 200                             |                       8 | **12.021 / 14.089 / 18.172**              |
| 100 files, two pages, 6 × 16 KiB sources | 8 × HTTP 200                             |                       6 | 5.876 / 7.361 / 9.658                     |
| Malformed PR metadata                    | 8 × expected HTTP 502 `INVALID_UPSTREAM` |                       8 | 1.141 / 1.631 / 3.878                     |
| Missing and truncated patches            | 8 × HTTP 200, four contexts              |                       4 | 3.366 / 3.716 / 6.101                     |
| Missing pinned source                    | 8 × HTTP 200, five contexts              |                       5 | 3.401 / 3.959 / 8.057                     |
| Source one byte over 128 KiB             | 8 × HTTP 200, five contexts              |                   **0** | **Unavailable; not estimated**            |

These min/median/max values summarize the returned warm per-second P99 groups, not population percentiles or proven worst cases. Small samples and adaptive data do not justify a production p95 promise. The 4-file and 100-file cases have almost no margin; only the one-file fixture stayed below 5 ms in all captured warm samples. None establishes a supported production envelope.

The first successful six-file/128-KiB request had an observed first-isolate marker and platform startup metadata: **25.350 ms invocation CPU**, **29.609 ms platform wall**, and **61.627 ms isolate startup CPU**. Startup is reported separately and must not be added to the invocation figure or compared to the 10 ms HTTP limit as though it were ordinary request CPU. Eager synthetic fixture initialization makes harness startup larger than a production ingestion bundle. Only this scenario has an observed cold ingestion sample; cold behavior for every other case was not proven.

The initial HTTP 404 had no harness headers. Route propagation is a plausible explanation, not a proven application diagnosis. It remains in the evidence. A separate 07:53:05 platform group with startup CPU cannot safely be attributed to that client failure. No request was added to replace it.

All 71 HTTP-200 responses were fully read, decoded and checked for verified final identity and exact expected inventory/context counts; malformed metadata produced eight expected safe errors. The unauthorized request returned 401. The 100-file scenario used **11 synthetic GitHub requests**; six-source cases used 10. No completed request silently reduced its intended source coverage.

The large-source client's median elapsed time was 70.34 ms, maximum 347.66 ms; large-patch median was 61.19 ms, maximum 177.51 ms. These include network/body transfer and are **not CPU**. Sampled platform wall fields remain in the raw evidence (for example, large-patch samples reached 22.022 ms).

All returned platform groups reported `success`, zero runtime errors and no `exceededResources` status. No client response showed a known CPU-limit termination. **That is not an exact zero-`exceededCpu` event ledger**: unrestricted runtime logging/tailing was intentionally not enabled, and the adaptive dataset is incomplete. Cloudflare documents CPU rollover allowance, which explains why a response can succeed above 10 ms. The measured CPU exceedances alone are sufficient to fail acceptance; a forced 1102 failure is unnecessary.

## Boundary and smallest proposed correction

The full six-file/128-KiB and large-patch workloads **cannot be described as reliably Workers Free ready**. Warm samples already exceed 10 ms, independently of cold startup. Smaller inputs passed the captured warm samples, but 9.855 ms and 9.658 ms tails leave inadequate headroom. Oversized-source CPU, exhaustive cold cases, native GitHub/TLS behavior, alternative locations, Unicode-heavy JSON, all 2-MiB page / 8-MiB aggregate extremes, concurrency and adversarial traffic remain unverified. Synthetic in-isolate responses do not represent network scheduling or all native fetch costs.

Platform metrics provide total CPU, not function-level attribution. Code inspection and the preserved M2 local profiles identify the remaining CPU-bearing work: bounded response reads and fatal UTF-8 decoding, JSON parsing/schema validation, patch preflight and byte counting, and response framing/encoding. Local sampled frames include `read`, `boundedText`, `serializeSnapshot`, `decode`, `encode` and Zod parsing; these are diagnostics, not platform percentages. Babel/rules/reports are absent from the backend build.

**Proposed next correction, not implemented:** keep the same one-request Hono/browser architecture and six-file/128-KiB limits, but retain bounded pinned source frames as bytes through ingestion and serialization. Preserve fatal UTF-8 validation, exact bytes, source identity, abort/deadline and aggregate byte accounting; avoid turning each source into a full string and then re-encoding it into a new frame. Remove redundant patch/source byte scans where a previously verified byte count can be reused, and measure metadata JSON/page overhead separately. This is a local byte-path/copy optimization, not permission to skip validation, discard files, change coverage or claim it will fit 10 ms.

Benchmark that narrow change locally first, with finding/coverage/framing parity, then request a separately authorized bounded on-platform retest including cold cases and oversized-response telemetry. If it still fails, propose one verified free Node-compatible ingestion host while retaining browser analysis. Do not add distributed analysis, queues, databases, extra per-file API calls or a paid plan automatically. This milestone provisions none of those alternatives.

## Cleanup and verification

- Exact disposable Worker deletion: HTTP **200**; follow-up settings lookup: **404**. Internal dashboard showed only the two pre-existing applications afterward. No live PRISM deployment remains.
- Temporary Wrangler OAuth session: `Successfully logged out`; `whoami --json` returned `loggedIn: false`. Browser login was left intact.
- Account remained Free. No AI binding or inference, billing change, custom domain, Vercel resource, GitHub ingestion, or Project 1/2 mutation occurred.
- Types, ESLint, formatting, **150 unit/integration tests**, **22 Playwright desktop/mobile tests**, frontend/backend builds and dependency audit (**zero vulnerabilities**) passed locally. Existing M1/M2 finding parity and browser lifecycle/privacy tests remain green. CI uses mocks and never runs this cloud experiment.

## Reproduction requires new authorization

`wrangler.cpu.jsonc` is an isolated harness build configuration, not an application deployment configuration. Its committed expiration is zero and there is no committed secret. It is not wired into CI or npm startup. A real rerun requires fresh account/plan confirmation and authorization; this experiment's grant has been cleaned up.

```sh
# Local build only; no deployment:
npx wrangler deploy --dry-run --config wrangler.cpu.jsonc --outdir artifacts/cpu-deploy
# After new authorization and scoped official login, operator-only:
# set PRISM_CPU_ACCOUNT_ID and PRISM_CPU_CONFIRMED_FREE=true in the process
npx tsx scripts/platform-cpu.ts
# Pure local derivation from sanitized evidence:
npx tsx scripts/platform-cpu-summary.ts
```

The operator script refuses to overwrite an existing same-name Worker, installs its secret on the initial upload, bounds invocations and metadata reads, and deletes only that exact named resource in cleanup. API credentials and the probe secret remain in memory during API execution; neither is placed in frontend variables, CLI arguments, artifacts, reports or repository files. Official OAuth state exists only for the temporary CLI login and is revoked afterward.

**M3 remains a separate proposal:** recheck shared Neurons and model eligibility, then separately authorize at most one fixed synthetic Gemma 4 binding probe, 256 input / 32 completion tokens, 10-Neuron budget, 20-second timeout, no retries or fallback. See [the exact provider experiment](NEXT-MILESTONE.md). It does not unblock full PRISM deployment or start agent implementation.

References: [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/), [platform metrics, rollover and invocation outcomes](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [official Workers GraphQL example](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), [adaptive sampling limitations](https://developers.cloudflare.com/analytics/graphql-api/sampling/).
