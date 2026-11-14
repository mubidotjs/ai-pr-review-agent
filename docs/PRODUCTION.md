# PRISM production

[https://prism.mubashirhussain.dev](https://prism.mubashirhussain.dev) is live on application SHA `16b9dbffce60b67548c0c5bb48346b363cf8480f`, with [passing exact-SHA CI](https://github.com/mubidotjs/ai-pr-review-agent/actions/runs/43609793842). [Sanitized deployment and verification evidence](production-live-result.json).

## What is live

The public React application includes the responsive deterministic workspace, browser analysis Worker, synthetic offline demo, file/diff navigation, evidence links and Markdown. The separate AI panel uses the real native Gemma adapter behind authenticated, same-origin Node APIs. Enter the privately delivered owner access code to unlock live review. No code or token is embedded in frontend variables or browser storage. Page load and the demo make no inference calls.

Vercel Hobby serves Node 24 ingestion and the separate agent Function through the existing raw-body streaming adapter. Each review preserves all original GitHub/source/time/byte limits. Backend-owned pinned evidence is prepared before a single native proposal call; Node independently validates selected supported predicates and constructs canonical findings. Cloudflare Workers Free hosts only the private native AI relay and one counter-only SQLite Durable Object. Shared atomic admission and estimated quota controls remain; they do not reserve GitHub's shared originating-IP allowance or the account-wide AI quota shared with Projects 1/2.

The owner reviews selected findings, explicitly approves them, then manually copies Markdown. There is no GitHub write capability or automatic publication. Browser-computed findings never become backend evidence. Only three risk categories and bounded context are assessed; partial coverage and zero findings are not a security clearance.

## Actual verification

- Earlier real synthetic native inference selected three hypotheses; Node validated all three canonical findings. Earlier real public-PR inference completed `honojs/hono#5620` in 2.597 seconds with eight GitHub GETs and an honest empty proposal set. Those receipts are preserved separately.
- This final release made **zero native dispatches, zero inference Neurons and zero live GitHub requests**. The deployed HTTPS approval test used a clearly labeled three-finding mock replay, prepared and independently validated in the trusted Node operator process. It registered through the existing private relay, then exercised actual deployed session/approval handlers. It did not create a public probe endpoint or claim new real-model findings.
- The corrected API-path cookie lookup worked. The actual canonical approved Markdown and OS clipboard matched after only Windows CRLF-to-LF conversion; raw/canonical hashes are recorded independently. The one-use replay draft was consumed; no publication occurred.
- The same deployment was promoted without rebuilding. The generated CNAME `prism → 31dce7aa9273dcb1.vercel-dns-017.com.` was entered manually in Dynadot. Ownership was already verified; no TXT or nameserver change was required. Local negative DNS caching and an unissued certificate initially blocked the new hostname. Public DNS confirmed the exact record; one Vercel-managed certificate for only `prism.mubashirhussain.dev` completed the domain setup. Normal HTTPS returned 200 with certificate checks enabled; HTTP redirects to HTTPS with 308.
- Canonical/social metadata and six local brand assets matched the deployed bytes/SHA-256. Desktop 1440 px and mobile 390 px render without horizontal page overflow; local/session storage remain empty. Custom-origin login and authenticated session read pass. Unauthenticated `/api/agent`, `/api/review` and the private relay return 401. No live review endpoint was exercised by these final checks; the model counter remained zero.

The five final check groups completed within the original 15-minute window. No app redeployment, model repeat or transport benchmark occurred. Temporary automation access was revoked. Runtime services, domain and managed certificate remain in production. Temporary credentials/logs are removed and the CLI grant is revoked. Projects 1/2 and unrelated recorded configuration fingerprints match.

## Owner operation

The access code is delivered in a private, ignored local file; it is intentionally absent from this repository and these receipts. Use it only at the production site's Private review access code field. It creates a signed HttpOnly, Secure, SameSite cookie scoped to `/api`, expiring after 30 minutes. Live reviews remain bounded and consume shared free allowances only when explicitly started. Do not publish the access code or expose anonymous model access.

Retain the five required server-only runtime variables in both Vercel environments. Keep Vercel's finite public origin configuration and the exact private relay origin/secret. Revoke temporary automation bypasses after maintenance. The deployed resource names are `mubidotjs-prism` and `prism-ai-review`; do not modify or remove Projects 1/2. Building or CI does not deploy. Any future deployment/inference work needs its own authorized scope; this completed release grants no speculative calls or extra infrastructure.
