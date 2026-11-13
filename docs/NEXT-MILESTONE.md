# Next milestone: isolated Vercel Hobby transport acceptance

M3 completed its one authorized native Workers AI probe: **provider path viable**, output `PRISM_PROBE_OK`, 24 prompt / 8 completion tokens. The temporary Worker, binding, secret and CLI authorization were removed. See [actual provider evidence](MILESTONE-3-PROVIDER.md). **No second inference or full agent implementation is authorized.** The application still shows AI disabled.

The remaining hosting blocker is independently established: full GitHub ingestion exceeds Workers Free CPU limits. Do not repeat the provider experiment to troubleshoot that unrelated problem.

[The hosting assessment](M3-INGESTION-HOSTING.md) recommends investigating one Vercel Hobby **Node.js** ingestion function with verified binary response streaming. An ordinary buffered function is insufficient: the current 12-MiB framed-response ceiling and a demonstrated valid 4,752,446-byte review exceed 4.5 MB. Current Vercel documentation exempts streamed response bodies. The 30-second application deadline fits within Hobby's current 300-second Fluid duration limit, but all existing application budgets remain unchanged.

M4 completed the local adapter and HTTP tests, preserving all limits. See [Node streaming implementation and evidence](MILESTONE-4-NODE-STREAMING.md). Its valid ingestion fixture is 4,752,446 bytes; the maximum synthetic transport frame is exactly 12,582,912 bytes. The packaged Function explicitly requests streaming and disables eager body helpers. **Vercel platform compatibility remains unverified.**

The smallest subsequent work, with separate authorization:

1. Confirm current Hobby eligibility, terms, remaining shared allowances, Node 24 support and cancellation opt-in, without a plan change.
2. Create one temporary, secret-protected synthetic transport harness with this exact Node adapter and Build Output API settings. Include no public frontend, live ingestion endpoint, GitHub credentials or AI binding. Keep application lifetime at 30 seconds, with the requested 40-second platform ceiling only providing termination margin.
3. Sequentially test a delayed prefix/tail, the 4,752,446-byte fixture, the 12-MiB ceiling, one bounded failure/deadline case and one client abort. Compare hashes/EOF, first-byte delivery, raw-body/routing behavior, no-store, cancellation and safe platform metadata. Make **zero model calls and zero live GitHub requests**; log no bodies or secrets.
4. Disable/delete the temporary deployment and secret, verify cleanup, and report pass/fail. Do not lower limits, split reviews, add infrastructure or use a paid fallback if the platform blocks required behavior.

A transport pass still leaves public admission and aggregate shared GitHub quota policy to establish. Per-instance busy gates/cooldowns cannot coordinate multiple functions or reserve the 60/hour originating-IP allowance. This acceptance gate authorizes neither production launch nor the full agent.

Any later AI work needs new explicit authorization, a fresh account/model/quota check, and a separately approved inference budget. Neurons remain shared with Projects 1 and 2. M3's successful single prompt does not establish production reliability, structured review output, agent safety, enabled-reasoning cap semantics or full PRISM deployment readiness. Server evidence must remain independently validated; client findings are not attestations.

No paid upgrade, credits, alternate model/provider, database, queue, distributed analysis or public production launch is implied by this proposal.
