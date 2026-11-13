# Next milestone proposal: verify the Node ingestion transport

M3 completed its one authorized native Workers AI probe: **provider path viable**, output `PRISM_PROBE_OK`, 24 prompt / 8 completion tokens. The temporary Worker, binding, secret and CLI authorization were removed. See [actual provider evidence](MILESTONE-3-PROVIDER.md). **No second inference or full agent implementation is authorized.** The application still shows AI disabled.

The remaining hosting blocker is independently established: full GitHub ingestion exceeds Workers Free CPU limits. Do not repeat the provider experiment to troubleshoot that unrelated problem.

[The hosting assessment](M3-INGESTION-HOSTING.md) recommends investigating one Vercel Hobby **Node.js** ingestion function with verified binary response streaming. An ordinary buffered function is insufficient: the current 12-MiB framed-response ceiling and a demonstrated valid 4,752,446-byte review exceed 4.5 MB. Current Vercel documentation exempts streamed response bodies. The 30-second application deadline fits within Hobby's current 300-second Fluid duration limit, but all existing application budgets remain unchanged.

The smallest subsequent work, with separate authorization:

1. Build a local Hono/Node adapter and mock-backed streaming parity tests. Preserve exact source identity, final verification, findings/coverage, all six source contexts and every request/byte/deadline limit.
2. Verify >4.5-MB and bounded 12-MiB binary frames, EOF/hash integrity, abort/backpressure, no buffering, no-store and safe partial/error behavior. Do not add storage or split the logical review.
3. Only after local verification, request one isolated Vercel Hobby transport experiment with confirmed free allowance, secret protection, synthetic data and cleanup. It should use **zero model calls and zero live GitHub requests**. No Vercel resources or migration are implemented in M3.

Any later AI work needs new explicit authorization, a fresh account/model/quota check, and a separately approved inference budget. Neurons remain shared with Projects 1 and 2. M3's successful single prompt does not establish production reliability, structured review output, agent safety, enabled-reasoning cap semantics or full PRISM deployment readiness. Server evidence must remain independently validated; client findings are not attestations.

No paid upgrade, credits, alternate model/provider, database, queue, distributed analysis or public production launch is implied by this proposal.
