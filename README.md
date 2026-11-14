# PRISM · AI PR Review Agent

An evidence-grounded AI pull request review agent that investigates GitHub diffs, identifies actionable risks, and produces human-reviewed suggestions.

**Real synthetic and public-PR AI reviews PASS; production release BLOCKED by operator replay setup.** The deployed app on `2f4f43e` completed `honojs/hono#5620` through one real native Gemma call and eight GitHub GETs in 2.597 seconds. It returned no supported hypotheses, without inventing findings. The three independently validated real synthetic findings and server approval from `d494bfd` remain preserved. HTTPS approval/copy was not reached because the operator looked for a `Path=/api` cookie at `/`; a new API-path helper and offline desktop/mobile regression correct that operator defect. Per the stop-on-failure scope, all new resources and authorization were removed; no promotion or DNS change occurred. The local clipboard correction remains verified. [Public-PR execution/cleanup evidence](docs/production-release-result.json); [copy evidence and executed scope](docs/COPY-ACCEPTANCE.md).

The offline assessment proves a conservative **8,126,464-byte** bound for valid ingestion; the 12-MiB fixture bypasses upstream limits. The corrected operator client allows **120 seconds** for that stress transfer while preserving the **30-second server deadline**. The deployed maximum transfer completed in **88.98 seconds**; server cancellation completed in **2.599 seconds**. [Evidence, reproduction and executed final scope](docs/FINAL-RELEASE-ACCEPTANCE.md).

The trusted backend now acquires GitHub data and prepares bounded pinned source without model decisions. Gemma receives one compact package and proposes only supported kind/path/line hypotheses. Node independently validates each selected hypothesis, constructs canonical findings and finalizes a partial draft without another inference. Empty proposals never promote deterministic matches. Human approval unlocks manual-copy Markdown only. Historical multi-turn behavior remains in explicit regression tests.

The native-contract correction accepts and discards documented assistant prose beside one strict tool call, retains full quota reservations when optional usage is absent, and preserves bounded field-specific diagnostics through the backend. The previous multi-turn run's timeout remains historical; the single-inference run accepted a real response and produced three validated findings. A later public-PR review also returned a valid response. Full production approval/copy and domain acceptance remain incomplete. [Native contract and historical evidence](docs/NATIVE-AI-COMPATIBILITY.md).

PRISM combines a responsive deterministic review workspace with a bounded single-inference AI review. It reads public GitHub PRs, pins evidence to the head SHA, refuses unsupported claims and lets a human approve selected findings for manual copy. Nothing posts to GitHub.

![Synthetic desktop review workspace](docs/demo-desktop.png)

[Mobile demonstration](docs/demo-mobile.png)

## Run locally

Requires Node.js **24.x** and npm. The default local path needs no account, token or cloud binding.

```sh
npm ci
npm run build:node
npm run preview:node
# http://127.0.0.1:4174
```

The initial synthetic demo works with external network access blocked. Paste a canonical `https://github.com/owner/repository/pull/123` URL to use read-only public GitHub ingestion. The default local server is deterministic; its separate AI panel stays unavailable without a configured release backend. No model calls occur on page load or in the demo. Offline means a locally served app, not an installed service worker.

```sh
npm run agent:demo
# Synthetic GitHub responses and scripted model decisions only.
npm run agent:demo -- --approve
# Optional terminal human approval; manual copy only.
```

## Implemented behavior

- Strict URL/SSRF defenses, public visibility, fork-aware pinned source, before/after snapshot verification, pagination and safe rate-limit errors without retries.
- Three conservative JS/TS/JSX/TSX rules: global `NaN` comparisons, recognized imported HTTPS Agent certificate-verification opt-outs, and recognized imported `jsonwebtoken.verify` expiration opt-outs. Strings/comments and uncertain bindings do not create findings.
- Dedicated browser Web Worker for deterministic analysis, bounded file/diff navigation, severity groups, exact source links, honest partial coverage, cancellation, stale-result rejection, offline demo and Markdown export.
- Backend-owned acquisition and source-window preparation, one native proposal call, independent added-line/AST validation and deterministic draft construction. Browser findings cannot become server attestations.
- Native Gemma 4 binding adapter with strict function decisions, bounded input/output, timeouts, no retries/fallback and explicit provenance. Offline fixtures, one real three-finding synthetic review and one real public-PR review are verified; HTTPS approval/copy and production release remain incomplete.
- Release access-code sessions, same-origin checks, shared atomic admission/quota reservations, one-use server-owned draft approval and manual-copy Markdown. All live endpoints remain access controlled.
- No GitHub write permission, arbitrary proxy, downloaded-code execution, accounts, analytics, persistent PR storage, queues or automatic publication.

## Limits and honest coverage

| Resource                                                       | Limit                                              |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Request body                                                   | 2 KiB                                              |
| File inventory                                                 | 100, two pages of 50                               |
| GitHub requests                                                | 12 per logical review, final verification reserved |
| Upstream concurrency                                           | At most 2; currently sequential                    |
| Individual / total review time                                 | 8 / 30 seconds                                     |
| Individual / aggregate upstream bytes                          | 2 / 8 MiB                                          |
| Individual patch / source                                      | 128 KiB                                            |
| Pinned source contexts                                         | 6, inventory order                                 |
| Parsed diff lines / findings                                   | 10,000 / 100                                       |
| Framed ingestion response                                      | 12 MiB                                             |
| Agent steps / production model calls / verification tool calls | 16 / 1 / 12                                        |

Deterministic coverage shows metadata total T, inventoried I, analyzed A, skipped I−A and uninventoried T−I. Agent coverage separately counts observed windows and completed supported-predicate checks; observing a window is not reviewing a whole file. Zero findings and unreviewed files never establish safety. Binary/missing patches, unsupported syntax, unavailable pinned source, deleted files and budgets produce explicit unknown/skipped states.

GitHub unauthenticated access shares **60 requests/hour per originating IP**, including other applications. Release admission allows **four reviews/hour**, one globally active review, **64 model decisions/day** and **2,000 estimated Neurons/day**. These controls cannot reserve an egress IP's GitHub quota or the account-wide Workers AI Free quota shared with Projects 1 and 2. Unknown provider outcomes retain their reservation. Estimated Neurons are not an enforceable provider per-call quota.

## Release boundary

`npm run build` creates the unchanged deterministic browser path, lightweight Node ingestion Function, separate Node agent Function and a **dry-run-only** Cloudflare relay build. Ingestion excludes Babel; AI evidence validation lives only in the separate Node Function. Both Functions reuse the existing streaming adapter, with raw bodies, a 30-second app deadline and 40-second platform configuration. Local HTTP tests preserve the **4,752,446-byte** ingestion fixture and **12,582,912-byte** transport fixture, with independent hash and EOF checks. Deployed acceptance verified both fixture sizes, incremental streaming, controlled incomplete framing and bounded server cancellation. The remaining release gate is real-AI acceptance of intentional selection/finalization and human approval, followed by public-PR and production verification.

Required **server-only** variables are in [.env.example](.env.example). Both Preview and Production must be configured before deployment; actual deployment target/identity is checked, including first-deployment Production behavior. Missing configuration fails closed. The public frontend/demo needs no secret. Live ingestion/AI requires a private access code in an HttpOnly signed cookie.

One native Cloudflare Durable Object is proposed for shared counters/replay protection across Vercel instances. Durable state contains counters, grant IDs and timestamps only. Canonical drafts stay in bounded RAM for five minutes; eviction returns an expired-draft error rather than trusting browser data. [Full trust, quota and approval details](docs/RELEASE.md).

No resources are provisioned by building or CI. The [current consolidated acceptance and release plan](docs/AI-TOOL-PROGRESS.md#one-replacement-acceptance-and-release-request--not-yet-authorized) is consumed after the recorded failure. No production release, further retry authorization or unrestricted inference endpoint is claimed.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

CI uses mocked upstream/provider responses, read-only permissions, no secrets and no deployments. The integration suite covers auth, native response schemas, cancellation, replay/quota controls, server evidence, approval, malformed output and finding/coverage parity. Playwright covers desktop/mobile, the offline deterministic workflow and mock-backed AI inspection/approval.

## Evidence and documentation

- [Current release implementation and authorization scope](docs/RELEASE.md)
- [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Portfolio description](docs/PORTFOLIO.md)
- [M5 existing agent contracts and adversarial tests](docs/MILESTONE-5-LOCAL-AGENT.md)
- [M4 local Node streaming evidence](docs/MILESTONE-4-NODE-STREAMING.md)
- [M4.5 historical Vercel setup failures and cleanup](docs/MILESTONE-4.5-VERCEL-STREAMING.md)
- [M3 successful native Gemma binding probe and cleanup](docs/MILESTONE-3-PROVIDER.md)
- [M2.5 actual Workers Free CPU failure](docs/MILESTONE-2.5-CPU.md) · [Browser architecture performance](docs/MILESTONE-2-PERFORMANCE.md)

The prior one-call M3 probe returned `PRISM_PROBE_OK`, using 24 prompt / 8 completion tokens and 0.44 shared Neurons. That result proved a basic native binding path, not this real agent workflow; it is not repeated by release preparation. Full ingestion exceeded Workers Free CPU limits, so ingestion and agent evidence validation belong on Node. Projects 1 and 2 remain unchanged.

MIT · [mubidotjs/ai-pr-review-agent](https://github.com/mubidotjs/ai-pr-review-agent)
