# Copy correction and remaining release scope

## Reproduced boundary

The previous synthetic acceptance on `d494bfd` established one genuine native Gemma response, three independently validated findings, authenticated deployed approval and exact canonical server Markdown. That evidence remains in [the immutable run report](https://github.com/mubidotjs/ai-pr-review-agent/blob/dca46678aa0532fef1fd246602a13469ce49e866/docs/ai-agent-acceptance-result.json). No further inference was performed for this correction.

The separate operator replay read the Windows clipboard and compared it directly with LF-only server Markdown. A local reproduction using its three canonical findings failed at **`clipboard-compare`**, exception **`Error`**, sanitized message **`Manual-copy integrity mismatch`**. The page origin was `http://127.0.0.1:4174`, `isSecureContext:true`, both Clipboard API methods existed, and clipboard write permission was granted. Windows returned **87 CRLF pairs** for a report containing LF only: **4,471 UTF-8 bytes written, 4,558 bytes read**. Replacing only CRLF with LF reproduced every original character. This reproduces a concrete harness defect; the discarded historical exception cannot establish that it was the only possible cause of that earlier run.

The historical draft, original run ID and approved Markdown body were deleted during required cleanup. They cannot be recovered from the safe report. `tests/fixtures/approved-copy-replay.json` is explicitly a **local reconstruction**, using the same three canonical findings/wording and stable replay identifiers. It is not the historical byte-for-byte provider receipt or a new real inference. Tests compare the exact committed reconstructed Markdown, rather than claiming to recover missing original bytes. Browser replay findings never become trusted backend evidence.

## Correction and verification

`scripts/release/verify-copy.ts` records a closed failing stage, exception name and sanitized fixed message. Arbitrary Playwright exceptions can contain DOM/source/credentials and are never persisted. Safe metadata includes origin, secure context, API availability, clipboard permission states, byte counts and SHA-256 values. The helper dispatches no inference, approval or GitHub requests.

The copy click now reports completion only after the write promise resolves. Acceptance waits for that completion before reading. Windows CF_UNICODETEXT line-ending conversion is explicitly distinguished from content corruption. The comparator permits **only CRLF → LF** on clipboard text: no trimming, bare-CR conversion, whitespace collapsing, Unicode normalization or other edit. Raw-byte equality is reported separately and is **false on this Windows run**, not misrepresented as a byte-exact clipboard transfer.

The corrected standalone replay verified ([safe metadata](copy-acceptance-result.json)):

- canonical Markdown SHA-256: `7ef3181b8e03c7eaed62b648c803cad94398328bb378ec50ff13eb7d1ed17b95`;
- clipboard raw SHA-256: `afe7082739630f8a2da5c72c05c0410f8977b32f72f5e342d972dc1f8aea3040`;
- clipboard SHA-256 after only CRLF → LF: identical to canonical Markdown;
- one locally replayed review and approval, **zero native dispatches, zero live GitHub requests, no publication**.

The application also had a real edge-case bug: accessing `.writeText` on an absent `navigator.clipboard` threw before its promise catch. `AIReviewPanel` now guards availability and awaits/catches both synchronous and asynchronous failure. Missing/rejected access shows the existing manual-copy instruction; the read-only textarea remains selectable with the exact approved text. A copied status appears only after success. No inference, evidence, authentication, approval, review-limit or deterministic behavior changed.

Focused desktop/mobile tests cover the three-finding report, actual clipboard content, delayed write completion, absent/rejected APIs, preserved textarea selection, no uncaught exception and no extra approval/review call. Unit tests reject all content changes beyond CRLF conversion and ensure safe exception diagnostics. Local verification passed: **450 unit/integration tests, 40 desktop/mobile Playwright tests (zero retries), types, ESLint, formatting, frontend/Node builds, Cloudflare dry compilation and zero audit vulnerabilities**. Exact-SHA CI must pass before release authorization.

Reproduction, after building and starting the normal loopback server:

```sh
npm run build:node
npm run preview:node
# Separate terminal; no deployment, GitHub or model call:
node --import tsx scripts/release/check-copy.ts
npx playwright test tests/e2e/ai-release.spec.ts --retries=0
```

The standalone replay rejects external browser traffic. Its ignored artifact contains only safe comparison/environment metadata. The consumed historical operator script is not rerun; subsequent acceptance uses the corrected shared helper. If a browser cannot access the OS clipboard, acceptance must report that limitation. A human can select all text in **Human-approved Markdown**, copy/paste it into a local editor and compare it against the approved report. Merely clicking Copy is not a PASS.

## One consolidated remaining release authorization — pending

The prior release scope was consumed and all temporary resources deleted. Request authorization once, after this correction has passing exact-SHA CI, for this complete remaining scope:

1. Retain the accepted Free/Hobby/Dynadot evidence. Refresh only model contract, shared AI quota and resource ownership through read-only APIs. No usage screenshots, transport tests or basic provider/synthetic AI probes. Preserve all other projects, plans and DNS records.
2. Create one `prism-ai-review` Cloudflare Worker with the existing native `@cf/google/gemma-4-26b-a4b-it` binding and one counter-only SQLite Durable Object namespace; one `mubidotjs-prism` Vercel Hobby project with **one staged Production deployment of this exact corrected SHA**. Reuse the existing Node 24 adapter, 40-second platform / 30-second review limits, matched Preview/Production variables and access-code safeguards. No new public fixture/probe endpoint.
3. Verify one real public-PR AI review of `https://github.com/honojs/hono/pull/5620` through the staged application: **one workflow, at most ONE native dispatch, 30 seconds, at most 12 live GitHub GETs and 600 additional estimated shared Neurons**. The full-size conservative estimate remains 529.997 Neurons per call; the 600 estimate is not a provider-enforced per-call quota and shares Projects 1/2's allowance. No inference for acquisition or finalization, retries or fallback. Empty proposals must be reported honestly. Do not repeat the already successful real synthetic finding proof.
4. Verify actual authenticated approval and clipboard content through the deployed HTTPS UI using the corrected helper. If the public PR has no supported findings, register **one explicitly labeled synthetic replay draft**, generated and independently validated in the trusted Node operator process from the existing fixed synthetic sources/three previously proven proposal coordinates, through the existing private relay `/draft`. This uses **zero native inference and zero live GitHub requests**; its result is labeled replay/mock, never a new real AI result. Replay only the completed-draft response in the test browser; send approval to the actual deployed authenticated backend. Verify the actual approved Markdown and OS clipboard, no GitHub publication, no new public investigation endpoint. Keep the same immutable production artifact. Use existing Vercel authentication/temporary scoped test access, never disable protection to bypass a failure; remove temporary access afterward.
5. Only after the public-PR and HTTPS approval/copy checks pass, promote the tested deployment, expose frontend/demo while keeping live endpoints access-code protected, and attach only `prism.mubashirhussain.dev` using Vercel's actual generated CNAME/required verification TXT. If authenticated Dynadot editing is unavailable, supply exact records for manual entry. Preserve `webhooks`, `release-notes`, `invoice` and every unrelated record. Verify HTTPS, icons/metadata and desktop/mobile within five final checks over 15 minutes, with **no further inference**.
6. Retain only runtime resources on complete success. Remove replay drafts, temporary test-access/operator secrets and revoke temporary CLI authorization either way. On the first failed criterion, stop without retries, repair calls or corrective redeployment; delete all new resources and only this run's DNS additions. Report the safe failing stage/category and actual cleanup evidence. No paid plan, production release on failed acceptance, other-project change, additional milestone or automatic subsequent attempt.
