# PRISM — AI PR Review Agent

PRISM is a read-only public pull-request reviewer built with React, TypeScript, Hono, a browser Web Worker and a bounded Node agent. It combines three conservative AST rules with model-selected investigation. Exact added-line evidence is independently validated against pinned GitHub source before a proposal can become an approvable finding. The backend constructs canonical severity, explanation, recommendation and source references; the model selects hypotheses and issued fact-card IDs.

The native Cloudflare Gemma adapter, authenticated live endpoints, shared quota controls and human-approved Markdown preserve the deterministic/offline UI and original review limits. No PR code is executed or persisted, and nothing posts to GitHub. Browser findings cannot become server attestations.

**Verified:** mocked-provider integration and finding/coverage parity; protected deployed Node 24 streaming, including exact 12-MiB integrity; and actual native Gemma function decisions. **Latest real review failed:** on `31d48d7`, 13 valid native decisions exhausted the tool budget on metadata/repeated inventories without reading source or producing a finding. Approval/copy and production release were not reached. All temporary resources and CLI authorization were removed; Projects 1/2 are unchanged. [Safe evidence](ai-agent-acceptance-result.json).

The focused offline correction adds backend-owned progress capabilities: source investigation takes priority after a useful inventory, metadata is read once, and repeated identical calls without new backend progress stop explicitly. Canonical evidence, supported risk categories, budgets, human approval and UI remain intact. No replacement live call has been made. [Correction and bounded release scope](AI-TOOL-PROGRESS.md).

PRISM icons and social metadata target `prism.mubashirhussain.dev`. A working AI review and production/custom-domain release remain unverified. The project is a limited assistant, never a security clearance or autonomous publisher.
