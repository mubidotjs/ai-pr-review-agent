# PRISM — AI PR Review Agent

PRISM is a read-only public pull-request reviewer built with React, TypeScript, Hono, a browser Web Worker and a bounded Node agent. It combines three conservative AST rules with model-selected investigation. Exact added-line evidence is independently validated against pinned GitHub source before a proposal can become an approvable finding. The backend constructs canonical severity, explanation, recommendation and source references; the model selects hypotheses and issued fact-card IDs.

The native Cloudflare Gemma adapter, authenticated live endpoints, shared quota controls and human-approved Markdown preserve the deterministic/offline UI and original review limits. No PR code is executed or persisted, and nothing posts to GitHub. Browser findings cannot become server attestations.

**Verified:** mocked integration and finding/coverage parity; deployed Node 24 streaming, including exact 12-MiB integrity; and real native Gemma investigation, hypothesis creation and independent backend fact-card validation. **Latest real review failed at finalization:** on `5b5a559`, five valid native decisions completed those steps, then dispatch six failed `PROVIDER_SHAPE` at response validation. The final review was suppressed; human approval/copy was not reached. All temporary resources and OAuth were removed, with Projects 1/2 unchanged. [Safe evidence](ai-agent-acceptance-result.json).

The focused offline correction adds backend-owned progress capabilities: source investigation takes priority after a useful inventory, metadata is read once, and repeated identical calls without new backend progress stop explicitly. Canonical evidence, supported risk categories, budgets, human approval and UI remain intact. The replacement live run avoided the inventory loop but exposed the separate final-response blocker. [Correction and bounded release scope](AI-TOOL-PROGRESS.md).

PRISM icons and social metadata target `prism.mubashirhussain.dev`. A working AI review and production/custom-domain release remain unverified. The project is a limited assistant, never a security clearance or autonomous publisher.
