# PRISM · AI PR Review Agent

An evidence-grounded AI pull request review agent that investigates GitHub diffs, identifies actionable risks, and produces human-reviewed suggestions.

**Transport PASS; latest real-agent acceptance FAIL (`PROVIDER_SHAPE`); no production release.** On `5b5a559`, five actual native Gemma decisions completed metadata, inventory, source inspection, hypothesis creation and backend fact-card validation. Dispatch six failed native response validation before finalization. The engine suppressed final findings; approval/copy was not reached. All temporary resources and OAuth were removed, with existing-project fingerprints unchanged. [Safe result and cleanup](docs/ai-agent-acceptance-result.json).

The offline assessment proves a conservative **8,126,464-byte** bound for valid ingestion; the 12-MiB fixture bypasses upstream limits. The corrected operator client allows **120 seconds** for that stress transfer while preserving the **30-second server deadline**. The deployed maximum transfer completed in **88.98 seconds**; server cancellation completed in **2.599 seconds**. [Evidence, reproduction and executed final scope](docs/FINAL-RELEASE-ACCEPTANCE.md).

Progress-aware native tools prevented the previous inventory loop. The latest live run establishes real source investigation and a backend-validated hypothesis. The focused offline correction now treats successful model-selected validation as intentional selection for a one-finding partial draft: Node independently revalidates it and finalizes without another model decision. The sixth-response defect remains unknown; no provider error is converted into success. New real-AI acceptance and human approval remain unverified. [Correction, tests and bounded release request](docs/AI-SELECTION-FINALIZATION.md); [prior live evidence](docs/AI-TOOL-PROGRESS.md).

PRISM combines a responsive deterministic review workspace with a separate bounded AI investigation workflow. It reads public GitHub PRs, pins evidence to the head SHA, refuses unsupported claims and lets a human approve selected findings for manual copy. Nothing posts to GitHub.

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
- Existing agent state machine and five backend-owned tools. A separate Node Function independently validates observed added lines and supported AST predicates; browser findings cannot become server attestations.
- Native Gemma 4 binding adapter with strict function decisions, bounded input/output, timeouts, no retries/fallback and explicit provenance. Newly integrated behavior is tested using **synthetic provider responses**; live agent behavior is not yet verified.
- Release access-code sessions, same-origin checks, shared atomic admission/quota reservations, one-use server-owned draft approval and manual-copy Markdown. All live endpoints remain access controlled.
- No GitHub write permission, arbitrary proxy, downloaded-code execution, accounts, analytics, persistent PR storage, queues or automatic publication.

## Limits and honest coverage

| Resource                               | Limit                                              |
| -------------------------------------- | -------------------------------------------------- |
| Request body                           | 2 KiB                                              |
| File inventory                         | 100, two pages of 50                               |
| GitHub requests                        | 12 per logical review, final verification reserved |
| Upstream concurrency                   | At most 2; currently sequential                    |
| Individual / total review time         | 8 / 30 seconds                                     |
| Individual / aggregate upstream bytes  | 2 / 8 MiB                                          |
| Individual patch / source              | 128 KiB                                            |
| Pinned source contexts                 | 6, inventory order                                 |
| Parsed diff lines / findings           | 10,000 / 100                                       |
| Framed ingestion response              | 12 MiB                                             |
| Agent steps / model calls / tool calls | 16 / 16 / 12                                       |

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
