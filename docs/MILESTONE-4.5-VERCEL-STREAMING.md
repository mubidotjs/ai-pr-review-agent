# M4.5: Vercel Hobby transport acceptance

**NOT VERIFIED. Neither authorized deployment established end-to-end streaming.** The M4 adapter and application remain unchanged. Both disposable deployments, their secrets and their temporary projects were deleted; their former URLs returned 404. The real `/api/review` route was absent. [Sanitized measurements and cleanup evidence](milestone-4.5-vercel-streaming.json) distinguish observed failures from untested platform behavior.

## Preflight evidence

On 2026-11-13 the selected team `team_YxkjSyqiyTtrcBTA8pfTNhpD` was active on **Hobby**, with no block or trial. The connected integration identified the account and existing projects; the existing authenticated Vercel CLI 64.5.0 supplied the full team billing metadata. No new CLI grant or login was created. The CLI cost-usage command cannot report this Hobby account's usage; it must not be interpreted as zero consumption.

The signed-in dashboard's Last 30 Days view (October 14–November 13) showed:

| Shared resource          | Used / included allowance |
| ------------------------ | ------------------------- |
| Fast Data Transfer       | 633.52 MB / 100 GB        |
| Fast Origin Transfer     | 300.92 MB / 10 GB         |
| Function invocations     | 33,269 / 1,000,000        |
| Fluid provisioned memory | 13.6 / 360 GB-hours       |
| Fluid active CPU         | 17m 8s / 4h               |

These advisory rounded observations leave ample room for a handful of sequential functional requests and approximately 18 MB of fixture delivery. They are shared account allowances, not a reservation. This is a private personal portfolio compatibility experiment without sales, advertising, customer traffic, load testing or a public service. That described use fits the current [personal/non-commercial Hobby terms](https://vercel.com/legal/terms); this assessment does not authorize a commercial launch.

[Current runtime documentation](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) lists Node 24. [Function limits](https://vercel.com/docs/functions/limitations) list a 300-second Hobby Fluid maximum and the streamed-response exemption from the ordinary 4.5-MB response ceiling. The experiment requests **40 seconds** at the platform boundary and retains the unchanged M4 **30-second** application deadline. Cancellation is explicitly opted in. Documentation establishes eligibility; measured delivery is a separate acceptance condition.

## Isolated artifact and controls

`scripts/vercel-transport/prepare.ts` creates an ignored Build Output API v3 artifact under `artifacts/m45-vercel`. The sole function is `/api/transport-probe`. It bundles the unchanged `src/server/node-adapter.ts`, native read-only file streams and fixed harness logic. A source-map guard excludes GitHub ingestion, Babel, analysis, the frontend and AI. No real PR URL, credentials, downloaded code, investigation tool or arbitrary file selector is accepted. Private binary assets cannot be fetched as static public files.

The two private binary fixtures are generated locally from synthetic data. The valid ingestion fixture passes the original bounded acquisition workflow locally using mocked responses; the cloud function only reads its resulting bytes. The 12-MiB fixture exercises transport capacity and makes no upstream-acquisition claim. Their expected sizes/hashes and the unchanged adapter hash are recorded in the generated manifest.

The function requires a random 256-bit backend secret, expires after 20 minutes, accepts only an empty POST body and five fixed case names, and retains Vercel deployment protection. Secret material is supplied through stdin, never command arguments, repository files, frontend variables or logs. Instance-local replay protection is advisory, not a distributed quota. Cases run sequentially with no retries. Intended logs contain only fixed case/event names, byte counters, elapsed time and Node version; arbitrary provider errors, bodies, headers and credentials are excluded. Neither deployed run entered a fixture stream, so no such event records were observed.

The exact test cases are delayed prefix/tail, 4,752,446-byte ingestion frame, 12,582,912-byte ceiling, controlled truncated/error frame and one timed client abort. A delayed prefix arriving before the configured tail-production delay and a separated tail establish streaming independently of clock synchronization. Large-case pass requires HTTP success, exact SHA-256, exact byte count and successful EOF. Cancellation additionally requires server-side cleanup evidence; a client timeout alone is insufficient.

## Operational incident and cleanup

One preview CLI command was rejected locally because `--skip-domain` is production-only. No deployment was created by that command. The same empty temporary project was reused after removing the flag.

The single actual deployment subsequently reached READY. Its client commands failed before HTTP dispatch: the runner placed `--cwd` after `vercel curl`, and CLI 64.5.0 forwarded it to native curl, which rejected the unknown option. The runner initially discarded stderr to avoid leaking authentication diagnostics; that also hid the useful fixed error classification. Consequently these zero-byte results do not establish a Vercel payload, adapter, buffering or cancellation failure.

The client was corrected to rely on its child-process working directory and classify only safe known diagnostic categories. A credential-free request to the already-deleted URL then returned HTTP 404 `DEPLOYMENT_NOT_FOUND`, proving that corrected invocation reaches HTTP. The user then explicitly authorized **one replacement deployment**. There were two actual deployments in total, not an unapproved retry of the initial authorization.

| Attempt                           | Exact deployment                                                                | Outcome                                                                |
| --------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Initial                           | `dpl_H4FZ3mhhXbPBrqufcJZ1UHxtweC1` / project `prj_hxzTD0hNKhS44MrUsFNVlEUKdlTZ` | READY; native curl rejected an option before HTTP dispatch             |
| Separately authorized replacement | `dpl_5kUHDepcRkQWtQPcZDnB3x3JuatT` / project `prj_COh3RY0nkVS9VH5O15lWTUKtht2F` | READY; HTTP reached the harness, but initialization returned empty 503 |

The replacement CLI request explicitly selected `preview`, but read-only deployment API metadata reported **`target: production`** and project Node version **24.x**. The installed official CLI also contains its first-deployment notice: new projects' first deployments can be assigned production implicitly. Both required harness variables had been added only to `preview`. That target/binding mismatch explains the fail-closed initialization response. The deployed generic guard did not expose a precise initialization category, and no secrets were decrypted to investigate it. A production target label here describes only the isolated synthetic harness; no PRISM application or public production service was launched.

| Replacement case        | HTTP / bytes received | Acceptance                                    |
| ----------------------- | --------------------- | --------------------------------------------- |
| Delayed prefix/tail     | 503 / 0               | No streaming proof                            |
| 4,752,446-byte frame    | 503 / 0               | Expected hash not observed                    |
| 12,582,912-byte frame   | 503 / 0               | Expected hash not observed                    |
| Controlled stream error | 503 / 0               | Intended error stream never started           |
| Client abort            | 503 / 0               | No cancellation or cleanup signal to validate |

The absent real ingestion route returned 404. Empty 503 responses had `Cache-Control: no-store` and safe Vercel request IDs; they contained no exception text, secrets or source. The old initialization fallback did not provide the full adapter header set, because initialization failed before the adapter was entered. Its HTTP EOF is **not** a successful review-frame EOF. The large fixtures' expected hashes remain in the manifest; zero received bytes cannot establish integrity. CLI-observed elapsed times include authentication/process overhead and are not Function CPU or streaming throughput measurements.

Both deployments, their probe secrets and temporary projects were removed. Their unique endpoints returned 404 and project lookups failed after deletion. The original four Vercel projects retained the same IDs and update timestamps, and the account remained active Hobby. Existing CLI authentication was reused and left intact; no new session needed revocation. No third deployment, live GitHub request, AI binding/inference, plan change or unrelated project modification occurred.

## Free observability limitation

Runtime-log queries completed without fixture events: the first client never dispatched HTTP, and the replacement failed before event emission. The CLI's function metric queries returned `payment_required`: Observability Plus requires Pro/Enterprise. No upgrade or add-on was enabled. This limits the available measurement surface; it is not evidence that Hobby Functions cannot stream. Another test must use available basic platform invocation records/logs and report missing metric detail honestly.

## Smallest correction, prepared locally but not deployed

The operator now scopes its disposable secret and expiry to **both preview and production**, inspects the effective deployment target and verifies matching variable metadata before fixture dispatch. It checks the unauthenticated 401 gate before spending fixture requests. The harness now emits fixed nonsecret configuration categories for missing secret/expiry/origin, and cleanup requires exact project ID/name/team verification. These are local harness/operator corrections; they were **not platform-verified** and do not change the M4 application or adapter.

The hosting gate remains blocked on a fresh, separately authorized synthetic acceptance experiment with those corrections. It must still prove the delayed prefix, both full sizes/hashes/EOF, safe controlled failure and server-side cancellation within the same limits. No review-size reduction, storage, paid observability, plan upgrade or full agent implementation is justified by these results.

## Running and publication

These are operator scripts, not application or CI deployment commands. `prepare.ts` is local-only; `run.ts` requires the exact newly created disposable project ID and the installed official CLI JS entry path. It verifies the target, sets only that project's temporary environment, makes at most one deployment command, collects bounded metadata, and deletes the secret/deployment/project in `finally`. Do not run it without an explicitly authorized temporary experiment and a current plan/allowance preflight.

The new harness tests cover its credential checks, hard expiry, empty-body contract, absence of the real ingestion route and absence of outbound fetch. M4's full local transport tests need not be repeated as an experiment; normal exact-SHA CI still runs the repository's standard checks after changes are published.
