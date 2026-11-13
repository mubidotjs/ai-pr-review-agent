# Milestone 2 architecture

## Selected split

React → dedicated browser Web Worker → one fixed same-origin `POST /api/review` → read-only Hono ingestion → versioned input snapshot → browser analysis/report → bounded UI rendering.

The backend owns strict original-URL validation, constructed GET endpoints, public visibility, metadata, pagination, rate limits/cooldowns, the 12-request logical budget, bounded pinned head contexts, before/after snapshot identity, safe errors, and request/response byte limits. There is no arbitrary proxy, unrestricted context route, model call, or review-posting route.

The browser Worker owns diff row creation, Babel JS/TS/JSX/TSX parsing, the unchanged three rules, source coordinates, evidence validation, findings, exact coverage, and Markdown. The build checks the backend source map for analysis/Babel/report dependencies and requires a separate Vite Worker asset. No analysis falls back to the UI thread or Cloudflare backend.

## Versioned input and wire format

`POST /api/review` still accepts exactly `{ "url": "https://github.com/owner/repository/pull/123" }`. Its success contract now returns input, **not findings**. This replaces Milestone 1's unversioned result contract; frontend and backend must be updated together.

Content type: `application/vnd.prism.review-input.v1`. The bounded response is:

1. Four-byte unsigned big-endian length of UTF-8 JSON metadata.
2. Metadata with `schemaVersion: 1`, capture ID, public PR metadata, file patches/status/counts, before/after identity, notices, budgets, and quota headers.
3. Raw UTF-8 source frames in file inventory order. Each context descriptor binds repository, head SHA, path, and exact byte length. Source text is excluded from the JSON metadata.

The frame format avoids escaping and serializing large source strings into JSON and avoids a second full JSON-body encoding. Header/metadata/source frames together must fit 12 MiB. All existing source/patch/file/request limits remain. The Worker reads the response directly; the UI never parses the full snapshot or receives full source contexts. JSON v1 input remains supported for bundled synthetic fixtures and tests, with the same structural limits.

Framing validation checks total size, prefix bounds, at most six source frames, frame lengths, UTF-8, and exact EOF. Snapshot validation rejects unknown versions/fields, inconsistent PR URLs, duplicate inventory paths, invalid counts, mismatched before/after identity, private/invalid head repositories, and contexts not bound to the exact head repository/SHA/path. Source text must match all new-side diff rows before any finding is accepted.

The capture ID is correlation metadata, not a credential, signature, resume capability, or server attestation.

## Preserving source selection and parity

The backend performs a bounded hunk count/coordinate preflight using the shared scanner with row materialization disabled. It has no AST or rule dependency. This small scan is necessary to retain the baseline's six-source selection: malformed or truncated patches must not consume slots ahead of six valid candidates. Shared scan semantics preserve attempted-line accounting, overflow rejection, and missing-patch behavior.

Full diff rows and every finding are independently built/validated inside the browser Worker. Missing patches, oversized patches (omitted with an explicit reason), unsupported files, deleted files, source failures, and budgets remain explicit. Unverified final captures have contexts removed and cannot produce findings. Changed SHAs/counts still fail the logical review.

Coverage remains metadata total T, inventoried I, analyzed A, skipped I−A, uninventoried T−I. Available-rule completion is not security clearance. The offline demo runs through the same Worker pipeline; an independent frozen Milestone 1 review fixture verifies finding/severity/coordinate/coverage parity.

## Worker lifecycle and UI

Vite bundles `new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' })`. Messages carry generation IDs. Each production job gets a fresh Worker and a watchdog; replacement, cancellation, errors, timeout, unmount, and completion terminate it. Late replies cannot update current state. A failed Worker can be replaced by a new one; there is no automatic retry.

Analysis has a 30-second wall budget independent of the backend's 30-second ingestion budget. The owner can terminate a CPU-bound synchronous Babel call; a message-based cancellation flag alone cannot do that. Inputs remain bounded at 100 files, six 128-KiB sources, 128-KiB patches, and 10,000 diff lines. Review/report output is capped at 24 MiB. These are input/output/duration controls, not an exact native heap/RSS quota.

ASTs and full contexts never return to React. React holds only the current bounded review and prebuilt Markdown. Diffs show 200 rows per page; all parsed rows remain accessible, and finding jumps select the correct page. No review content goes to local/session storage, IndexedDB, Cache Storage, cookies, or a service worker. Ordinary static-code caching is distinct from review data.

## Trust and future tools

Browser findings are **client-computed and not server-attested**. `snapshotVerified` describes backend capture consistency and does not certify a browser-produced explanation or export. A browser owner can forge client output. No backend endpoint accepts findings or promotes them into server authority.

`src/server/agent.ts` preserves typed future `getPullRequest`, `listChangedFiles`, `readFileContext`, `createReviewFinding`, and `validateReviewFinding` contracts without importing Babel into ingestion. A future bounded agent must use inventory-scoped backend capabilities and independently reacquire/validate trusted evidence server-side. Client JSON, flags, counters, and explanations are not a substitute. The current adapter remains disabled and calls no tools or model.

## Deployment boundary

Only local same-origin execution is configured. Separate Vercel/Worker origins would require explicit origin allowlists, OPTIONS handling, origin checks, frontend API configuration, CSP connect/worker policy, HTTPS, abuse controls, and runtime CPU verification. CORS alone is not authentication. None of those resources or production settings are provisioned.

The heavy-analysis dependency is removed from the backend path, but [M2.5 actual platform measurements](MILESTONE-2.5-CPU.md) **failed the full-workload Workers Free CPU gate**. Large-source warm groups exceeded 10 ms, and cold ingestion reached 25.350 ms. The one temporary fixture deployment was deleted. Production configuration and authorization remain absent. A proposed bounded byte-path optimization preserves all current limits and validation; it has not been implemented or verified. No application architecture changed during M2.5.

[M3 verified one isolated native AI binding response](MILESTONE-3-PROVIDER.md), then removed its Worker, binding and secret. The application adapter remains disabled. [A Node ingestion host with verified streaming](M3-INGESTION-HOSTING.md) is now a documented candidate: ordinary buffered responses cannot carry the current envelope above 4.5 MB. No migration or Vercel resource is implemented; the local ingestion/browser architecture and all limits are unchanged.
