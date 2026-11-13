# PRISM — AI PR Review Agent

PRISM is a read-only public pull-request reviewer built with React, TypeScript, Hono, a browser Web Worker and a bounded Node agent. It combines three conservative AST rules with model-selected investigation through five scoped tools. Exact added-line evidence is independently validated against pinned GitHub source before a proposal can become an approvable finding.

The release integration adds a native Cloudflare Gemma 4 adapter, authenticated live endpoints, atomic shared quota controls and human-approved Markdown. It preserves the working deterministic/offline interface and the original review limits. PR content is not persisted; no code is executed and nothing posts to GitHub.

**Verified so far:** local mocked-provider integration, deterministic finding/evidence parity and local Node binary streaming. **Not yet verified:** deployed streaming, the real agent workflow, production end-to-end acceptance. The historical basic native inference probe succeeded but does not prove the full agent. [Current release and authorization plan](RELEASE.md).

The engineering focus is evidence authority, conservative claims, bounded tools/cost, prompt-injection containment, partial coverage, transport integrity and human control. This is a limited review assistant, never a security clearance or autonomous publisher.
