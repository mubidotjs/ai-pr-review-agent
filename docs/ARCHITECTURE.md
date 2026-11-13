# Architecture

## Request flow

React form → same-origin `POST /api/review` → Hono in local workerd → bounded GitHub GETs → diff parser → pinned source → Babel rules → evidence validation → final snapshot check → typed report → React/Markdown.

The public API accepts exactly `{ "url": "https://github.com/owner/repository/pull/123" }`. Success returns a `Review` defined in `src/shared/types.ts`; failures return `{ error: { code, message, rateLimit?, retryAt? } }`. Unknown endpoints, including investigation tools and GitHub write operations, are unavailable.

The state trace is `validate → fetch → parse → analyze → validate-findings → complete|partial`. Fatal invalid input, inconsistent metadata, or changed SHAs produce structured failures. Context failures become per-file skipped reasons. Failed final verification suppresses all findings and resets analyzed coverage.

## Tool contracts

`ReviewTools` in `src/server/review.ts` describes five backend-owned integration points:

| Tool                    | Input / result                                                                     | Authority                                                          |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `getPullRequest`        | Validated owner/repository/PR ref → metadata including SHA and count               | Exact public REST endpoint                                         |
| `listChangedFiles`      | Validated PR ref, bounded page → file statuses and patches                         | Two pages; no arbitrary pagination URL                             |
| `readFileContext`       | Verified snapshot, changed path → bounded head source                              | Public head repository, exact head SHA                             |
| `createReviewFinding`   | Candidate + file + source + snapshot + provenance → validated finding or rejection | Does not execute code or publish anything                          |
| `validateReviewFinding` | Finding + trusted review snapshot evidence → boolean                               | Exact added line, matching source, canonical link, required fields |

The current coordinator supplies only paths from its changed-file inventory. A future adapter must receive a scoped capability wrapper that enforces that inventory, budget, and snapshot; never expose a raw GitHub client or network transport to a model. TypeScript interfaces alone are not a security boundary.

The disabled AI adapter returns `{ status: "disabled", findings: [] }` without invoking any tool. The deterministic engine always tags its output `deterministic`. The validator can structurally validate future AI provenance, but this does not prove an explanation is semantically correct. Human review remains necessary.

## Evidence rules

Parse complete JS/TS/JSX/TSX source without executing it. Match only the documented static constructs and emit only when the decisive token is on a real added line. Verify all available new-side hunk rows against exact head-source lines. Deleted-side coordinates come only from the patch and are never used as head-source links.

Conservative whole-file binding checks reject recognized import names if shadowed anywhere, reassigned, or mutated through a directly visible member assignment. This intentionally skips some valid lexical cases. CommonJS aliases, re-exports, dynamic options, spreads, duplicated option keys, unknown libraries, and unsupported syntax are not inferred. Direct eval/with makes analysis incomplete. This is not a complete type/dataflow engine.

## Source and snapshot identity

The base repository must match the supplied URL and be public. Context uses the public `head.repo.full_name`, exact head SHA, and new filename after a rename. Deleted or inaccessible forks/commits have no context fallback. Metadata is fetched again after analysis; base SHA, head SHA, head repository, and changed-file count must still match.

Per-file source failure never becomes a weak-pattern finding. Exact source links are constructed from trusted coordinates and encoded filename segments, rather than copied from arbitrary API URLs.

## Runtime boundary

Local development and built preview are same-origin. GitHub traffic originates only in the backend. The browser receives the bounded diff/report, not full source contexts. All PR state is request/session memory; the only cross-request backend state is an ephemeral cooldown timestamp and active-review counter.

A future separate Vercel frontend and Worker backend would require explicit origin allowlists, OPTIONS/preflight handling, origin checks, frontend API URL configuration, CSP `connect-src`, HTTPS, abuse controls, and deployment-specific settings. CORS is not authentication. None of these production resources or cross-origin settings are configured now.

The pure parser/rule/evidence modules remain separable from transport so CPU constraints can be addressed without weakening local functionality. See CPU feasibility before deciding on production hosting.
