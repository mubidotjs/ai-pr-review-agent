import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parsePullRequestUrl } from '../src/server/security';
import type { ReviewInputSnapshot } from '../src/shared/types';
import { analyzeSnapshot } from '../src/analysis/review';

const url = process.argv[2];
if (!url)
  throw new Error(
    'Usage: npm run smoke -- https://github.com/owner/repository/pull/123 (local preview must be running)',
  );
parsePullRequestUrl(url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // Capture the real wire input before the dedicated Worker disposes its network target.
  // route.fetch still issues exactly one local backend request; no extra GitHub review.
  let captured: { ok: boolean; body: Uint8Array } | undefined;
  await page.route('**/api/review', async (route) => {
    const response = await route.fetch({ timeout: 35000, maxRedirects: 0 });
    const body = Uint8Array.from(await response.body());
    captured = { ok: response.ok(), body };
    await route.fulfill({ response, body: Buffer.from(body) });
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('Public pull request URL').fill(url);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/review') &&
      response.request().method() === 'POST',
    { timeout: 35000 },
  );
  await page
    .getByRole('button', { name: 'Review pull request', exact: true })
    .click();
  const response = await responsePromise;
  if (!captured || !captured.ok || !response.ok())
    throw new Error('Live snapshot ingestion failed.');
  const bytes = Uint8Array.from(captured.body);
  const body = decodeSnapshotWire(bytes.buffer);
  const input = body as ReviewInputSnapshot;
  const review = analyzeSnapshot(input).review;
  if (
    !review.snapshotVerified ||
    review.budget.requests > 12 ||
    review.ai.status !== 'disabled'
  )
    throw new Error('Live smoke acceptance failed.');
  for (const finding of review.findings) {
    const file = review.files.find((f) => f.path === finding.path);
    if (
      !file?.rows.some(
        (r) =>
          r.kind === 'add' &&
          r.newLine === finding.line &&
          r.text === finding.evidence,
      )
    )
      throw new Error('Live evidence mismatch.');
  }
  await page
    .getByRole('heading', { name: review.pr.title, exact: true })
    .waitFor();
  if ((await page.locator('.finding-card').count()) !== review.findings.length)
    throw new Error('Browser/Node finding parity failed.');
  mkdirSync('docs', { recursive: true });
  // Store verification metadata only, never PR descriptions, patches, or source content.
  const evidence = {
    timestamp: new Date().toISOString(),
    url: review.pr.url,
    headSha: review.pr.headSha,
    baseSha: review.pr.baseSha,
    coverage: review.coverage,
    status: review.status,
    snapshotVerified: review.snapshotVerified,
    budget: review.budget,
    rateLimit: review.rateLimit,
    findings: review.findings.length,
    ai: review.ai.status,
    flow: 'Headless Chromium form → same-origin built preview → local workerd → unauthenticated GitHub REST → pinned context → versioned input → dedicated browser Worker → rendered PR heading',
  };
  writeFileSync(
    'docs/milestone-2-live-smoke-results.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/live-smoke.png', fullPage: true });
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
