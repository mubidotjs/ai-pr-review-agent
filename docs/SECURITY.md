# Security model and limitations

All PR titles, bodies, paths, comments, patches, and code are untrusted data. Comments that impersonate system instructions cannot alter the deterministic coordinator. No repository instructions are executed or imported. Babel parses text in a dedicated browser Worker; reviewed content receives no executable capability or investigation tools.

## Enforced boundaries

- Original URL representation is validated before normalization. Only exact HTTPS github.com PR URLs are accepted; credentials, explicit ports, encoded traversal, alternate hosts, and query/fragment suffixes are rejected.
- Backend requests use constructed api.github.com REST endpoints, GET only, controlled headers, strict timeouts, streamed byte limits, and redirect rejection. No token, caller cookie, or authorization header is forwarded.
- Repository visibility and PR identity are checked. Pinned context paths are encoded segment-by-segment and drawn from the inventory. No arbitrary URL or context endpoint exists.
- React text rendering escapes content; there is no `dangerouslySetInnerHTML`, repository HTML rendering, automatic image loading, or Markdown HTML preview. Markdown export escapes HTML, syntax, control characters, and code fences.
- API responses use no-store. Static built assets declare CSP, referrer, framing, MIME-sniffing, and device-permission restrictions. Local origins are checked; permissive CORS is absent.
- No accounts, persistent PR storage, analytics, local storage, provider keys, GitHub tokens, or automatic review posting. Public source content travels only through the local backend and current browser session.

## Known limitations

Three rules cannot establish correctness or security. Findings identify specific observable code behavior and require a human to assess intent and exposure. Authentication/TLS warnings are not proof of exploitation.

The AST checks use conservative static import/binding recognition, not a full type checker or control/dataflow analysis. They do not establish every possible runtime mutation. Matching code in tests or examples can still produce a contextual manual-review warning when it is real executable syntax; strings/comments and uncertain API bindings do not.

Missing patches are marked “binary, empty, or omitted” rather than asserting a binary classification. Diff count/hunk inconsistencies, parse errors, mismatched source, deleted files, unavailable forks, and exhausted budgets are explicitly unreviewed. Some supported files remain skipped because only six pinned source reads are allowed.

Diff materialization and Babel run synchronously inside the dedicated browser Worker. The backend runs only a bounded eligibility scanner, with no ASTs or row construction. Input sizes and line counts are bounded, but cooperative cancellation cannot preempt synchronous parsing, so the UI owner terminates the Worker on cancellation or timeout. Sources and ASTs remain in that disposable execution context; only diff rows and the resulting report return to the UI. Pathological parser errors are caught, and CPU measurements flag production feasibility separately. No deployed Free-tier claim is made.

The 60/hour GitHub quota is shared by originating IP, not reserved for this application. Counters are advisory snapshots; other clients can consume quota concurrently. The local cooldown is per process, not durable or shared across instances. No retry loop or quota-bypass fallback exists.

Cloudflare/Vite/Wrangler and browser tooling may maintain ordinary development caches and logs. Application code does not persist PR content. Browser Workers have no storage writes; they are terminated after each review. HTTP snapshot responses and client reads use no-store. Browser data is not accepted as server-attested evidence. Explicit test scripts save synthetic fixtures, diagnostic profiles, and minimal live-smoke verification metadata; live smoke excludes source, patches, descriptions, and tokens.

Do not expose the local development server as a production service. Multi-user abuse prevention, production cross-origin policy, privacy disclosures, and production CPU feasibility require separate design and verification.

## Snapshot and attestation boundary

`POST /api/review` returns a versioned, size-bounded input snapshot with trusted capture metadata, patches, and at most six pinned contexts. It exposes no arbitrary URL or unrestricted file endpoint and does not accept findings. Input framing checks exact lengths/EOF; Worker validation binds PR URL, before/after identities, head repository/SHA/path, counts, byte limits, and allowed fields. Source/diff equality is checked independently before findings are created.

These are consistency checks, not cryptographic attestation. A user controlling a browser can forge client output. Neither exported Markdown nor `snapshotVerified` makes a browser finding a server-validated claim. Future AI agents must independently obtain trusted server evidence and validate it server-side; no implementation currently promotes browser findings to server authority.

Vite bundles a fixed local Worker module. Repository text never selects a module URL, runs through eval/Function, or becomes an import. The analysis Worker makes at most one request to the fixed same-origin ingestion endpoint; all GitHub investigation remains in the backend. Unsupported browsers show a safe error instead of running analysis on the UI thread or restoring it to the Cloudflare backend.
