# PRISM · AI PR Review Agent

An evidence-grounded AI pull request review agent that investigates GitHub diffs, identifies actionable risks, and produces human-reviewed suggestions.

**Milestone 4: Hono ingestion now has a locally verified Node adapter with binary streaming through 12 MiB. Deployed Vercel compatibility is unverified. The browser Worker and review limits are unchanged; application AI remains disabled.**

PRISM reads a public GitHub PR through a minimal Hono service, then maps its diff and applies three narrow JavaScript/TypeScript rules in a dedicated browser Web Worker. Findings have exact evidence and honest coverage, but no server attestation. A seeded synthetic demonstration works without external network access. Nothing posts to GitHub.

![Synthetic desktop review workspace](docs/demo-desktop.png)

[Mobile demonstration](docs/demo-mobile.png)

## Run locally

Requires Node.js **24.x** and npm. No cloud account, API key, GitHub token, or `.env` file is needed for the Node path.

```sh
npm ci
npm run build:node
npm run preview:node
```

Open **http://127.0.0.1:4174**. The demonstration is loaded initially; paste a canonical `https://github.com/owner/repository/pull/123` URL for a real public review. Demo data is clearly fictional, and its illustrative source links are not presented as real PR evidence.

The Node server serves React, its bundled browser Worker and Hono ingestion on one loopback origin. The backend never runs Babel or generates findings. Build-time module-graph checks enforce this boundary in both runtimes. The application has no AI, storage, or remote resource bindings. `build:node` also creates an ignored local Build Output API artifact; it does not provision or link a Vercel project. Its Function requires an explicit `PRISM_PUBLIC_ORIGIN` and otherwise fails closed. Cloud experiments require separate authorization.

The legacy workerd path remains available (requires a supported local workerd platform):

```sh
npm run dev
# http://127.0.0.1:5173
npm run build
npm run preview
# http://127.0.0.1:4173
```

“Offline demo” means the locally served app works with all external network access blocked. It does not install a service worker or promise availability after the local server stops.

## What works

- Strict public GitHub PR URL validation and read-only, unauthenticated REST ingestion.
- Metadata, base/head SHAs, paginated file inventory, unified diffs, renamed/deleted files, and exact added-line coordinates.
- Pinned head source checks, fork-aware source links, snapshot revalidation, and rejection of unsupported findings.
- Three conservative rules: global `NaN` comparisons, recognized HTTPS Agent certificate-verification opt-outs, and recognized `jsonwebtoken.verify` expiration opt-outs.
- Severity groups, file navigation, responsive diff views, 200-row paging with finding jumps, explicit unknown states, copyable Markdown, and a selectable report fallback. All bounded diff rows remain available.
- Worker cancellation/termination, stale-result rejection, bounded snapshot validation, and recovery without main-thread analysis fallback.
- No accounts, analytics, persistent PR storage, repository code execution, automatic comments, or AI calls.

## Coverage and limits

Every report shows **total, inventoried, analyzed, skipped, and uninventoried** file counts. Total comes from PR metadata; skipped is inventoried minus analyzed; uninventoried is total minus inventoried. “Analyzed” means only that the available rules completed. Zero findings is **not** a security clearance.

| Resource                              | Hard application limit                      |
| ------------------------------------- | ------------------------------------------- |
| Request body                          | 2 KiB                                       |
| Inventoried files                     | 100, two pages of 50                        |
| GitHub requests                       | 12, with final verification reserved        |
| Concurrent upstream requests          | 2; current workflow is sequential           |
| Concurrent local reviews              | 1 per app instance                          |
| Individual / total wall time          | 8 / 30 seconds                              |
| Individual / aggregate upstream bytes | 2 / 8 MiB                                   |
| Individual patch / head source        | 128 / 128 KiB                               |
| Pinned source files                   | 6, inventory order                          |
| Parsed diff lines                     | 10,000, including attempted malformed hunks |
| Findings                              | 100                                         |

GitHub unauthenticated reads share **60 requests/hour per originating IP**, including other applications using that IP. Response quota headers are inspected, one remaining unit is reserved for verification, and primary/secondary limits stop work without automatic retries. An in-memory cooldown prevents immediate repeated requests in the same local process. This is not a distributed quota coordinator.

Binary and missing patches are not guessed apart: GitHub may omit a patch for several reasons. Unsupported syntax/languages, unavailable pinned source, deletions, excessive sizes, and budget exhaustion produce explicit skipped states. No source fallback uses a moving branch. If final snapshot verification fails, findings are suppressed.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

`check` runs types, lint, formatting, unit/integration tests (including local workerd and Node HTTP), frontend/backend builds for both runtime paths, and a packaged Node Function HTTP check. Playwright serves the UI through Node, preserving desktop/mobile flows and adding binary-decoder and real API checks. CI uses synthetic upstream data and performs no live GitHub ingestion, deployment or inference.

With preview already running, an explicitly selected live smoke test is:

```sh
npm run smoke -- https://github.com/owner/repository/pull/123
```

It verifies browser → local Worker → public GitHub → rendered result, writes verification metadata only, and consumes the originating IP's GitHub quota. It never runs in CI.

## CPU architecture and performance

CPU-heavy diff materialization, Babel parsing, rules, coordinate/evidence checks, finding construction, coverage, and Markdown generation now run in a dedicated browser Web Worker. The backend owns strict URL/API security, the 12-request logical budget, pinned source retrieval, and before/after verification. It returns a versioned bounded input, not findings.

A small bounded hunk preflight remains on the backend to preserve which six files get source context; it creates no diff rows or ASTs. Framed metadata plus raw UTF-8 source frames avoid large source-to-JSON escaping. The UI receives the resulting review/report, never full source contexts. Each production review gets a fresh Worker, terminated on completion, cancellation, errors, replacement, or timeout.

See [actual Milestone 2.5 platform measurements](docs/MILESTONE-2.5-CPU.md). On the verified Free account, six near-128-KiB sources used **11.295–17.322 ms in captured warm groups and 25.350 ms on the observed cold ingestion**; large patches reached **18.172 ms**. These exceed 10 ms despite successful responses. **The full workload failed the Free CPU gate.** Smaller fixtures do not prove a production envelope. The test Worker was deleted and temporary CLI authorization revoked. The proposed next correction reduces source decoding/encoding copies without reducing review limits; it is not implemented or claimed sufficient.

The [Milestone 2 local performance report](docs/MILESTONE-2-PERFORMANCE.md) and original [Milestone 1 CPU evidence](docs/CPU-FEASIBILITY.md) remain available. Local samples and platform adaptive analytics have different limitations and must not be equated.

```sh
# Start the built preview first, then:
npm run benchmark:browser
npm run benchmark:ingestion
# For actual local workerd profiling, start in another terminal:
npx wrangler dev --local --config wrangler.test.jsonc --port 8787 --inspector-port 9229
npm run benchmark:worker
```

Profiling uses synthetic inputs, not GitHub or AI. Browser results include startup/bundle size, cold/warm analysis, sampled CPU, transfer/clone costs, responsiveness, and heap observations. Exact methodology and limitations are in the report. `benchmark:ui` additionally compares an ignored export of the verified baseline; setup is documented there.

## Architecture and next milestone

- [Architecture and tool contracts](docs/ARCHITECTURE.md)
- [M4 Node streaming evidence and remaining platform gate](docs/MILESTONE-4-NODE-STREAMING.md)
- [Security and limitations](docs/SECURITY.md)
- [M3 actual native provider result and cleanup](docs/MILESTONE-3-PROVIDER.md)
- [Historical M3 Node ingestion assessment](docs/M3-INGESTION-HOSTING.md)
- [Next transport verification proposal](docs/NEXT-MILESTONE.md)

The future agent has typed backend tool interfaces and an explicitly disabled adapter. There is no provider SDK, LangGraph, MCP server, database, or distributed orchestration.

Workers AI quota is shared at the account level. A future Project 3 inference may consume allowance shared with Projects 1 and 2. The next experiment requires a shared-quota check and a separately authorized small inference budget; there is no promise of zero impact.

M3 made exactly one authorized synthetic inference through an isolated native binding: `PRISM_PROBE_OK`, 24 prompt / 8 completion tokens. Shared daily usage updated from 0 to 0.44 Neurons. The temporary Worker, binding, secret and CLI authorization were removed. No production deployment, Vercel resource, hosting migration, DNS change, plan upgrade or change to the other portfolio projects occurred.

MIT · [mubidotjs/ai-pr-review-agent](https://github.com/mubidotjs/ai-pr-review-agent)
