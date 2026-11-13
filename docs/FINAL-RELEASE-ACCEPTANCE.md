# Final release blocker: offline evidence and one authorization scope

Status: **authorized scope executed: transport PASS; real-agent acceptance FAIL; all new resources removed.** The corrected 120-second client delivered the exact maximum fixture in 88.98 seconds, and controlled error/server cancellation passed. The first synthetic agent workflow stopped at `MODEL_ERROR` after one native dispatch, with no validated decision or findings. No second workflow, public GitHub request or production release followed. [Actual results and cleanup](release-acceptance-result.json). Production `src/`, `api/`, app limits, server deadlines, risk categories, evidence authority and UI remain unchanged.

## Can a valid review reach 12 MiB?

No. The configured 12-MiB envelope is a defensive transport ceiling, not the maximum reachable output from bounded GitHub ingestion. [Reproducible offline assessment](release-transport-offline.json) and [bound calculation](../scripts/vercel-transport/envelope.ts):

| Retained component                                | Conservative bytes |
| ------------------------------------------------- | -----------------: |
| Two changed-file JSON pages, at most 2 MiB each   |          4,194,304 |
| Initial PR metadata JSON response                 |          2,097,152 |
| Six raw UTF-8 source frames, at most 128 KiB each |            786,432 |
| Generated-field and normalization allowance       |          1,048,576 |
| **Conservative framed response upper bound**      |      **8,126,464** |

The serializer replaces JSON source text with raw UTF-8 frames; it does not escape the six sources into JSON. For retained patch/path/status/title/description strings, canonical JSON string encoding cannot exceed their original valid upstream JSON token sizes: it uses literal UTF-8 or required escapes, and removes optional escaping/whitespace. Schema-projected fields drop upstream keys and rename file keys to shorter names. Integer normalization may expand scientific notation; the allowance charges that separately. Only the initial PR metadata is retained. Final metadata verifies identity, and the separate public-repository response is not copied wholesale.

The allowance reserves worst-case six-byte escapes per UTF-16 unit for **100 × 1,024-character context reasons**, **two × 2,048-character ingestion notices**, **six complete context descriptors**, derived PR references, both verification identities and the valid snapshot's 100-character rate-resource field. Another 16 KiB covers structural keys, UUID, frame header and scalar/number normalization. Their combined bound is **751,978 bytes**, below the 1-MiB allowance. Ingestion appends notices at only two catch sites. This even charges impossible combinations, such as control characters in safe context paths. Malformed upstream data or overlong rate headers cannot establish a valid browser review; the existing validation rejects them. The separate 8-MiB upstream aggregate, 12-request, diff, source and time budgets can only tighten this upper bound.

The unchanged valid example has **100 files, six 128-KiB sources, 11 mocked GitHub requests and verified pinned identity**. It produces exactly **4,752,446 bytes** from 5,008,596 upstream bytes. A maximum-length title/description containing JSON control-character escapes produces **6,161,427 bytes** from 7,826,558 upstream bytes and passes the same snapshot validation. Neither example is claimed to attain the mathematical maximum.

The existing exact 12,582,912-byte stress fixture deliberately constructs a snapshot without acquisition. Its hypothetical 50-file pages would be **5,772,045** and **6,558,001 bytes**: each violates the 2-MiB per-response limit, and together they exceed the entire 8-MiB upstream budget before metadata or sources. Valid framing alone is not proof of valid GitHub acquisition. We retain the fixture and every existing limit; its outstanding transport check still gates this release.

Reproduce offline, without GitHub or AI calls:

```sh
node --import tsx scripts/vercel-transport/assess-envelope.ts
npx vitest run tests/transport-client.test.ts tests/ingestion-envelope.test.ts
```

## Corrected client and local verification

The side-effect-free [shared transport client](../scripts/vercel-transport/client.ts) now serves the operator runner and focused loopback tests. Maximum fixture transfer timeout: **120 seconds**. Controlled error: **35 seconds**. Deliberate abort: **3 seconds**. Native curl retries: **zero**. A separate process watchdog allows 25 seconds for CLI startup/protection access; it is not an application or Function extension. The server remains at **30 seconds** and the platform configuration remains at **40 seconds**. The server can finish handing off bytes while a downstream proxy/client continues receiving buffered bytes.

After authorization and target/environment verification, the exact outstanding-case runner is:

```sh
# PRISM_VERCEL_CLI is the installed official CLI JavaScript path, not a token.
node --import tsx scripts/release/transport.ts \
  https://ACTUAL-ACCEPTANCE-DEPLOYMENT.vercel.app \
  artifacts/final-release/credentials.json \
  artifacts/final-release/transport.json
```

It validates the linked `mubidotjs-prism` project/team, uses `artifacts/release-acceptance` as the child process cwd, refuses an existing ledger and records each attempt before dispatch. It runs only **maximum → error → abort**, stops at the first failure and performs no deployments, logins, model calls or retries. Fresh approval and operator provisioning are prerequisites, not effects of running/importing the client.

Before transmitting the operator secret, a read-only platform metadata check also verifies the exact project, staged Production/READY state, deployment URL, Node 24 and `prismReleaseSha` against the local commit.

The maximum command produced is:

```text
node <official-vercel-cli.js> curl /api/transport-probe --deployment <verified-url> --scope mubidotjs-projects -- --config -
```

Its stdin curl configuration sets `request = "POST"`, `data = ""`, `include`, `no-buffer`, `silent`, `show-error`, `suppress-connect-headers`, **`max-time = 120`**, **`retry = 0`**, `Accept-Encoding: identity`, an empty `Expect` header, `X-Prism-Case: maximum`, and the server-only `X-Prism-Probe` secret. Secrets never appear in argv, persisted results or stdout; no `--cwd` is forwarded to native curl. The local tests use the same parser/hash/classifier and native curl directly against loopback.

Eight focused checks passed locally. They verify exact 12-MiB SHA-256/count/EOF through the actual protected harness; command construction; the default 120-second cap and rejection above it; a real shortened curl timeout; same-length corruption; a recognized platform timeout header; controlled four-byte incomplete framing rejected by the existing decoder; and actual client abort with the server's cancellation event below 30 seconds. An additional fixed downstream emulator receives the maximum frame from the unchanged Node handler, then delays its tail **36 seconds**. The corrected client succeeds beyond the previous 35-second limit with exact integrity after the source completed within 30 seconds. This is an offline reproduction of deadline separation, **not a cloud acceptance pass**.

Full local verification on Node 24.22.1/Windows x64 passed: **270 unit/integration tests, 30 desktop/mobile Playwright tests, types, ESLint, formatting, frontend/Node/dry-run relay builds, both operator artifact preparations and dependency audit (zero vulnerabilities)**. No live GitHub request, cloud deployment or inference was made for this correction.

Failure classification is conservative:

| Evidence                                                     | Classification                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| Native curl exit 28                                          | `CLIENT_TIMEOUT`                                               |
| Separate process watchdog fires                              | `CLIENT_WATCHDOG`                                              |
| Recognized `x-vercel-error` termination code                 | `PLATFORM_TERMINATION`                                         |
| Successful EOF, expected count, wrong hash                   | `RESPONSE_CORRUPTION`                                          |
| Successful EOF, wrong count                                  | `INCOMPLETE_TRANSFER`                                          |
| Connection/process ends without recognized platform evidence | `CONNECTION_OR_PROCESS_TERMINATED`; cause not inferred         |
| Expected four-byte error prefix                              | `EXPECTED_INCOMPLETE_FRAME`; never a successful decoded review |

Safe platform metadata must additionally corroborate controlled error and bounded cancellation before inference. A Node source `complete` event alone does not attest remote delivery. Arbitrary stderr, provider exceptions, credentials and payload bodies are never collected.

## One consolidated final authorization — authorized and executed

The user explicitly approved this scope for commit `30bb34baecf08ab0dbc13c9b86f66edc1dc38c06`, after [exact-SHA CI passed](https://github.com/mubidotjs/ai-pr-review-agent/actions/runs/43477735935). It was executed once and stopped at the failed first synthetic agent decision. The successful delayed/4,752,446-byte transport checks and basic Gemma probe were not repeated. The scope below is an execution record, not continuing permission for another run; neither this document nor local tests authorize cloud calls.

1. **Fresh preflight:** confirm Workers Free, Durable Objects Free availability, Vercel Hobby/noncommercial portfolio eligibility and allowances, Node 24/streaming support, current Gemma native contract/account eligibility, and at least 2,000 shared Neurons remaining. Record Projects 1/2 and other existing-project fingerprints. No billing changes. Stop on a failed mandatory check.
2. **Exact resources/deployments:** create one new Vercel project `mubidotjs-prism` in `mubidotjs-projects`; at most **two deployments on the same verified SHA**, staged-Production protected acceptance then the normal app. Verify required server variables in both Preview/Production and actual deployment target/version. Use generated `vercel.app` domains only. Unexpected name collisions cause a stop. No Git auto-deploy integration. No other project changes.
3. **Outstanding transport only:** once each, sequentially: exact **12,582,912-byte** maximum frame with 120-second client transfer bound and independent expected hash `3438b890c3b885defdebebde8dcd7c73736bffb20961571c257f9e3eba7d2409`; controlled error with decoder rejection; client abort with safe server cancellation evidence. Use the unchanged actual Node adapter, 30-second server deadline, 40-second platform duration, secret protection and bounded operator expiry. Read only free allowlisted metadata. No retries, alternate paths, timeout escalation, frame-limit reduction or paid observability. If any check fails, delete the new Vercel project/secrets and stop before creating a Cloudflare resource or making inference calls.
4. **Only after transport passes:** create at most **one Cloudflare deployment** named `prism-ai-review`, native Gemma AI binding, one `ReviewBudget` SQLite Durable Object counter namespace and one `prism-global-v1` object. No custom CPU/plan upgrade, storage of PR content or other service. Publish the relay secret with the initial deployment and remove the temporary local secrets file. Required application environment already points to this planned generated `workers.dev` origin; none of the prior transport fixtures invoke it.
5. **Real agent acceptance/release:** at most **two agent workflows / 32 native model dispatches total**, **2,000 estimated Neurons total for this run**, shared with Projects 1 and 2. First the fixed synthetic acceptance review through the existing real adapter, supported-finding validation and prompt-injection safeguards. If it passes, deploy the normal app as the second/final Vercel deployment, excluding operator routes/fixtures/secrets. Then one normal real-public-PR agent workflow. No repeated basic inference probe, repair calls, alternate model/provider or automatic retry. Existing per-turn token limits, 18/20-second binding/relay timeouts, 30-second workflow budget, independent pinned evidence and supported risk categories stay unchanged. Estimates are not provider-enforced per-call quotas; unknown outcomes retain reservations. Stop and clean up on failure or missing required acceptance evidence.
6. **Public PR/UI and abuse checks:** one deterministic capture and one agent capture of `https://github.com/honojs/hono/pull/5620`, at most **24 public GitHub GETs total**, only through the deployed app. No alternate PR. Verify real results, source coordinates, human selection/approval/manual copy and responsive UI. No GitHub writes. Keep signed access-code sessions and shared admission/quota controls; make only the frontend/demo public. Remove Vercel Authentication only for this new project when ready for its authorized public frontend, while live review/inference stays access-code protected. At most six additional non-inference authentication/health/error requests and five no-inference final smoke/cleanup requests; static assets excluded. Use mock-backed exhaustion/error tests rather than extra live calls.
7. **Cleanup and evidence:** retain production only on complete acceptance success. Delete the acceptance deployment and operator secrets in both scopes; verify inaccessibility and operator-route absence. On any failure, delete all newly created resources/secrets/namespace data, including the Cloudflare relay if it was reached; no additional deployment or repeat experiment. Revoke temporary CLI authorization and remove local generated secrets, preserving pre-existing Vercel authentication. On success hand the owner the access code through an ignored local file outside served assets. Recheck plans, shared usage and unrelated fingerprints. Publish safe results and verify exact-SHA CI. No third deployment solely for documentation.

No paid upgrades, other-project modifications, new features, infrastructure redesign or full-agent expansion are part of this request.
