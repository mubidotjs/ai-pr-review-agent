# M4: local Node ingestion and binary streaming

**Local Node compatibility passes; deployed Vercel compatibility remains unverified.** M4 changes the hosting adapter, not the browser analysis architecture. No Vercel/Cloudflare deployment, inference, real GitHub ingestion, plan change or other portfolio-project change occurred.

## Implementation

`src/server/node-adapter.ts` wraps the pinned official `@hono/node-server@2.1.8` `getRequestListener`. `src/server/node.ts` constructs the existing Hono application; there is no duplicate GitHub business logic. `api/[...path].ts` exports a native IncomingMessage/ServerResponse handler. `src/server/node-local.ts` serves the built frontend and this same API adapter on loopback port 4174, with same-origin requests and restrictive headers. The legacy local workerd development path remains available.

`npm run build:node` builds the unchanged React/browser Worker with Vite, bundles the Node entry and dependencies, checks source maps for forbidden Babel/analysis/report/client dependencies, and emits a local **Build Output API v3** artifact. It does not invoke the Vercel CLI or create/link a project. Generated `.vercel/output` is ignored. The Function metadata explicitly requests:

```json
{
  "runtime": "nodejs24.x",
  "handler": "api.mjs",
  "launcherType": "Nodejs",
  "shouldAddHelpers": false,
  "supportsResponseStreaming": true,
  "maxDuration": 40
}
```

Disabling helpers preserves original request bytes instead of accepting an eagerly parsed/consumed body. The adapter refuses a parsed body. `PRISM_PUBLIC_ORIGIN` must be an exact HTTPS origin (loopback HTTP permitted locally); unset/invalid configuration fails closed with 503 before GitHub access. Host must match this origin. Forwarding headers cannot redefine it. Existing same-origin validation remains in Hono. No public origin, secret, account link or production resource is configured in M4.

The 40-second platform termination request provides margin; it does **not** extend the logical review. The Node wrapper caps admission, ingestion and delivery at 30 seconds from handler entry, propagates client cancellation to Hono/GitHub, and destroys a partial transfer on expiry. The existing 30-second ingestion and 8-second upstream limits are retained. Vercel's own upload/proxy time and cancellation forwarding remain platform acceptance questions.

## Streaming behavior

The shared serializer now produces one frame segment at a time, with chunks no larger than 64 KiB and zero application read-ahead. Bytes and v1 framing are unchanged: big-endian metadata length, UTF-8 metadata, then inventory-ordered raw UTF-8 contexts. Encoding bounded metadata/source text still requires bounded in-memory buffers; this is incremental **delivery**, not a claim of constant-space ingestion or incremental JSON serialization.

The Node wrapper removes HTTP Content-Length, preserves the exact byte count in `X-Prism-Snapshot-Bytes`, and explicitly uses HTTP/1 chunked transport. This selects the official adapter's stream writer instead of its small-response coalescing path. That writer waits for Node `drain`; the wrapper adds a pull-driven 64-KiB guard, a 12-MiB cumulative cap and exact EOF verification against the declared frame size. The frontend decoder, source validation and browser Worker are unchanged.

Neither the success path nor the Function adapter calls `text()`, `json()` or `arrayBuffer()` on a snapshot. Small fixed error responses may be buffered. Auto-draining unread requests is disabled; rejected input closes the connection. After binary headers, source errors, truncation, over-limit streams, disconnects and timeouts terminate the HTTP connection. They never append exception text/JSON or report successful EOF. Errors before headers use fixed safe JSON and `no-store`.

## Exact local evidence

[Recorded metadata](milestone-4-node-streaming.json) was collected on Windows x64 / Node 24.22.1 with `npm run verify:node`. It contains only synthetic counts, hashes and timing metadata. It is not a platform performance claim. That command runs after each Node build and verifies the **packaged native ESM Function entry** over an actual loopback HTTP server, not just a stream helper.

| HTTP case                                                        |         Exact bytes | Verification                                                                 |
| ---------------------------------------------------------------- | ------------------: | ---------------------------------------------------------------------------- |
| Valid bounded ingestion, two 50-file pages, six 128-KiB contexts |           4,752,446 | 11 mocked GitHub requests, final snapshot verification, decoder/EOF, SHA-256 |
| Synthetic transport ceiling                                      | 12,582,912 (12 MiB) | Independent frame oracle, exact SHA-256/byte order/EOF, unchanged decoder    |

The maximum-frame case uses the same Node HTTP adapter with a directly constructed snapshot; it is a **transport-ceiling** test, not a claim that this fixture can be acquired within the 8-MiB GitHub aggregate budget. The 4,752,446-byte case passes real ingestion bounds and final verification. Its duration and UUID are controlled in unit tests to stabilize exact bytes; the recorded artifact check controls duration, so its capture ID/hash can vary between runs. The 12-MiB fixture/hash is deterministic and includes non-ASCII context text.

Additional actual-HTTP tests prove first-prefix delivery while the producer deliberately withholds its tail, bounded production while a real client pauses reading, and source cancellation on disconnect. They check declared/undeclared overflow, truncated frames, invalid UTF-8/JSON, trailing bytes, source errors, transfer/ingestion deadlines, admission recovery, Host/Origin validation, chunked and declared request limits, safe errors, rate cooldown without retries, and removal of evidence on final-verification failure. An ended source cannot receive a cancellation callback; a short declared length still fails transport rather than completing successfully.

## Finding and coverage parity

The Node success route feeds the unchanged binary decoder and deterministic pipeline. Its findings, source coordinates/links and coverage equal the existing frozen demo oracle: 8 inventoried, 5 analyzed, 3 skipped, 0 uninventoried. AI remains disabled; report provenance remains client-computed with `serverAttested: false`. The full 100-file transport fixture reports 6 analyzed and 94 skipped without treating zero findings as clearance. All shared limits are unchanged, including six source files, per-source/patch 128 KiB, 100 inventory files, 12 logical requests with final reserve, upstream byte budgets and pinned-SHA verification.

Full unit/integration tests retain the workerd path as well as Node. Playwright now serves the UI through Node and retains all existing desktop/mobile flows, with additional binary-decoder and real Node API checks. CI runs types, ESLint, formatting, unit/integration tests, both backend/frontend build paths, the packaged-artifact HTTP check, Playwright and the dependency audit. All upstream responses in CI are synthetic; no deployment or inference step exists.

Local release checks passed: **182 unit/integration tests across 15 files, 26 Playwright desktop/mobile tests, types, ESLint, formatting, both runtime builds and the packaged-artifact HTTP check; dependency audit: 0 vulnerabilities.** The preserved Windows capture observed 186 ms for the large ingestion round trip and 410 ms for the 12-MiB transport case including verification work. These are single local elapsed observations, not CPU measurements or Vercel latency promises. Exact-SHA Actions verification is reported with the published commit.

## Public endpoint prerequisites

This artifact is **not approved for public launch**. Before enabling a public endpoint:

- Keep same-origin routing and exact deployment-origin configuration. Verify preview URLs, Host forwarding, API routing, cancellation propagation, no-store/CSP and raw body behavior on the actual platform. Separate origins require explicit allowlists, preflight handling and CSP changes; CORS is not authorization.
- Add and verify a platform-supported admission/abuse boundary within confirmed Hobby allowances. Establish per-client and aggregate caps, small request/header limits, concurrency limits, transfer/deadline enforcement and a way to disable ingestion. An Origin check alone does not stop direct clients. This milestone adds no accounts, distributed limiter or infrastructure.
- Unauthenticated GitHub's 60/hour quota is shared by originating IP. Twelve requests per review can consume it quickly; egress addresses may be shared or change. Instance-local busy gates/cooldowns do not coordinate Vercel instances, guarantee aggregate admission or reserve quota. Inspect rate headers, stop on exhaustion/secondary cooldown, show manual reset guidance, and never retry automatically or rotate IPs to evade limits. A public multi-instance quota policy remains a launch blocker.
- Limit logs to safe status/timing metadata; do not log request bodies, sources, PR descriptions, authorization or arbitrary upstream exceptions. Verify platform instrumentation too. Keep PR data ephemeral, downloaded code unexecuted and GitHub access read-only.
- Browser findings/exports are untrusted outside the UI. A future AI agent must independently obtain and validate backend-owned inventory, pinned source, real added lines and source links; no client attestation flag can replace that work. The disabled agent interfaces are unchanged.

## Remaining Vercel uncertainty and next acceptance gate

Local HTTP/1 behavior does not establish Vercel's launcher/front-proxy streaming exemption, HTTP/2 framing, compression, routing, raw request preservation, cancellation, cold starts or effective Hobby limits. Explicit `supportsResponseStreaming` metadata is intent, not measurement. The 4.5-MB ordinary response limit remains a blocker unless the actual deployed path is verified as streaming. No automatic size reduction, review splitting, storage or paid fallback is authorized.

With **separate authorization**, confirm the current Hobby plan, terms, remaining allowance and cancellation configuration, then create one isolated, secret-protected temporary transport Function using this exact adapter/runtime/artifact configuration. No frontend, custom domain, ingestion credentials, live GitHub calls or AI binding. Use fixed synthetic cases only: a delayed small frame (prove prefix arrives before tail), the valid 4,752,446-byte fixture, the 12-MiB ceiling, one bounded failure/deadline case and one client abort. Keep tests sequential and bounded; compare byte counts/hashes/EOF and safe platform status/duration metadata, ensure bodies/secrets are absent from logs, then disable/delete the temporary deployment and secret and verify cleanup. Do not include the real `/api/review` ingestion endpoint in that test deployment. If the platform buffers or rejects a required payload, report that blocker without adding infrastructure. This gate establishes hosting transport only; it does not authorize a full agent or production launch.

## Primary references checked for M4

- [Hono official Node adapter, pinned 2.1.8 listener](https://github.com/honojs/node-server/blob/v2.1.8/src/listener.ts) and [stream writer](https://github.com/honojs/node-server/blob/v2.1.8/src/utils.ts).
- [Vercel Build Output API Function primitives](https://vercel.com/docs/build-output-api/primitives): explicit `supportsResponseStreaming` and `shouldAddHelpers` metadata.
- [Vercel Function limitations](https://vercel.com/docs/functions/limitations): ordinary 4.5-MB response limit and streamed-response exemption; deployed behavior must still be measured.
- [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js): native Node handler and cancellation requirements.
