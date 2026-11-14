# PRISM — AI PR Review Agent

**Live:** [prism.mubashirhussain.dev](https://prism.mubashirhussain.dev). [Production verification](PRODUCTION.md) · [Safe deployment receipt](production-live-result.json).

PRISM is an evidence-grounded public pull-request reviewer built with React, TypeScript, Hono, Vercel Hobby Node Functions, a browser Web Worker and a private Cloudflare Workers AI binding. The frontend/demo is public; live ingestion and AI require the private owner access code. No accounts, analytics, paid services or GitHub write permissions are used.

The trusted backend acquires public GitHub data under a 12-request budget, pins source to the verified head SHA, checks snapshot consistency and prepares bounded source windows. One native Gemma function call proposes only kind/path/line hypotheses. Node independently checks added-line evidence and conservative AST predicates before constructing severity, explanation, recommendation and source links. Unsupported claims are refused. A human selects and approves findings for manual-copy Markdown; nothing is posted automatically.

Real acceptance established three independently validated synthetic findings from one native response, plus one genuine public-PR review that honestly returned no supported proposals. The final exact-SHA production deployment reused this evidence with **zero new inference or live GitHub requests**. Actual HTTPS authentication/approval and clipboard content were verified using an explicitly labeled, backend-validated replay. The domain, managed certificate, branding assets, desktop/mobile UI and protected endpoints pass. Temporary test access and CLI credentials were removed; production services remain and Projects 1/2 are unchanged.

The deterministic workspace and offline demo remain independently useful. Omitted context stays unreviewed, browser results have no server attestation, and three supported risk categories never constitute a comprehensive security review. Original file/source/time/byte limits, cancellation, quota controls, prompt-injection boundaries and manual approval are retained.

Deployed application SHA: `16b9dbffce60b67548c0c5bb48346b363cf8480f` · [passing CI](https://github.com/mubidotjs/ai-pr-review-agent/actions/runs/43609793842). Historical acceptance failures remain in their archived receipts; they are not the current production status.
