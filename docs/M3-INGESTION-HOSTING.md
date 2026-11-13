# Documentation decision: Vercel Hobby Node.js ingestion boundary

**Recommendation: investigate one Vercel Hobby Node.js Function for read-only ingestion, with verified response streaming. It is a better CPU candidate than the demonstrated full-workload Workers Free path, but it is not yet a verified deployment or a drop-in buffered migration.** Browser Web Worker analysis and every current review/security limit stay in place. M3 implements and deploys no Vercel resource or hosting adapter.

The native Workers AI path is independently viable for M3's one small synthetic prompt. That does not make full GitHub ingestion fit Workers Free's 10 ms CPU allowance; the M2.5 failure remains valid. No CPU test was repeated in M3.

## Payload ceiling: an actual compatibility issue

The current application accepts only a **2-KiB request body**, comfortably below Vercel's **4.5 MB** function request limit. Its framed response has a separate **12-MiB ceiling = 12,582,912 bytes**, so the ordinary buffered response limit is insufficient. A frame is binary metadata plus source frames; measuring its JSON metadata alone is incorrect. Compression cannot be assumed to waive a function payload limit.

This is not merely a loose configured ceiling. A new **size-only synthetic fixture** passes the unchanged ingestion limits and final snapshot verification while producing:

| Measurement                          |            Exact bytes/count |
| ------------------------------------ | ---------------------------: |
| Framed response                      |          **4,752,446 bytes** |
| First / second 50-file upstream page |  1,848,491 / 1,848,501 bytes |
| Each of six pinned source contexts   |                131,072 bytes |
| Aggregate upstream data              | 5,008,596 bytes, below 8 MiB |
| GitHub-shaped synthetic requests     |                 11, below 12 |
| Files / contexts                     |                      100 / 6 |
| Snapshot consistency                 |                     Verified |

The example exceeds both **4,500,000 bytes** and **4.5 MiB = 4,718,592 bytes**. It uses 100 individually bounded patches, six full source contexts and a bounded PR description. It neither truncates coverage nor changes any limit. [Raw size evidence](milestone-3-payload-envelope.json), [fixture](../tests/ingestion-payload-fixture.ts), and [regression](../tests/ingestion-payload.test.ts) preserve the calculation. This is not a CPU or elapsed-time benchmark and calls neither GitHub nor a model.

Current [official function limits](https://vercel.com/docs/functions/limitations#request-body-size) explicitly exempt **streamed response bodies** from the 4.5-MB response ceiling; the request-body limit still applies. This changes the architecture assessment: an actually streamed binary response is a plausible way to retain all existing limits without storage or multiple review requests. A buffered Hono/Node adapter is unsuitable for the full workload.

PRISM already returns a `ReadableStream` with a framed content type and Content-Length. **That alone does not prove that a Vercel adapter/runtime will deliver it through the exempt streaming path.** A future adapter must preserve byte order, exact EOF, abort/backpressure behavior, `no-store`, and a maximum of 12 MiB, with no intermediate `text()`, `json()`, `arrayBuffer()` or response buffering. Verify Content-Length/chunking behavior in the actual adapter and platform path; do not assume an eagerly enqueued stream or content-type label is enough. The browser framing decoder remains unchanged.

If streaming is unavailable in the selected adapter/path, report a migration blocker. Do not silently lower limits, split the logical review, add Blob storage, queues or a paid plan. Storage and multiple requests are unnecessary if a verified native streaming boundary works.

## Duration, CPU and free allowance

Current [Node.js function limits](https://vercel.com/docs/functions/limitations#max-duration) give Hobby with Fluid Compute a **300-second default and maximum**, substantially above PRISM's **30-second logical ingestion deadline**. Keep the application deadline at 30 seconds, individual GitHub reads at 8 seconds, and reserve final-verification request capacity. A platform maximum is a termination ceiling, not permission to extend application budgets. A future function configuration needs enough margin for bounded framing/response handling; a platform timeout exactly at the application deadline could replace a safe partial/error response with a platform error.

The 20-ms-class CPU work observed on Workers Free is not subject to that same 10-ms per-invocation gate on Hobby Node.js. This is a platform-limit comparison, **not a new Node performance measurement or a promise of reliability**. Native fetch behavior, cold starts, response streaming, cancellation, memory and adversarial inputs still need validation under the chosen runtime.

The [Hobby allowance](https://vercel.com/docs/plans/hobby) currently includes 4 active CPU-hours, 360 provisioned-memory GB-hours and one million function invocations per month, plus transfer limits. These are shared plan allowances, not a private reserve for this project. No Vercel account allowance, entitlement, project or billing setting was changed or newly verified in M3. Confirm applicable current plan terms, account use and available allowance before any deployment request; do not assume unlimited free capacity or authorize an upgrade.

## Preserve the ingestion trust boundary

A future Node function would own the same strict public GitHub URL validation, constructed read-only requests, public visibility checks, two-page inventory, 12-request logical budget, exact head-SHA context, final snapshot recheck, source byte/line limits and safe errors. It would expose no URL proxy or unrestricted context endpoint. Browser findings remain client-computed and cannot become server-attested merely because ingestion moves hosts.

Use a same-origin frontend/API route if the future hosting arrangement permits it. Separate origins still require explicit allowlists, preflight/origin validation, CSP changes and independent deployment configuration; CORS is not authentication. Retain no-store, restrictive headers, ephemeral review data, escaped repository text, no repository-code execution and no automatic GitHub writes. No PR bodies, sources, tokens or arbitrary upstream errors should appear in platform logs. Public abuse control must be designed without pretending a process-local cooldown coordinates multiple function instances or the shared unauthenticated GitHub IP quota.

## Smallest subsequent milestone, not implemented

With separate authorization, build a **local Hono-to-Node adapter and streaming parity tests first**. Check the legal >4.5-MB fixture and a bounded 12-MiB framing fixture, byte hashes/EOF, cancellation, safe errors, all 12-request/30-second limits, and unchanged findings/coverage. Only then request one isolated Vercel Hobby transport experiment, with synthetic fixtures, secret protection, confirmed free allowance and cleanup. It should make **zero inference calls** and no live GitHub requests. Passing payload/deadline tests would justify a later hosting decision, not automatic agent implementation or production launch.

No application, frontend, Cloudflare ingestion architecture or deployment configuration was changed for this assessment. Existing local functionality and all limits remain intact.
