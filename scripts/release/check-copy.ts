// Local UI replay only. No model, GitHub, authenticated cloud or deployment calls.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import {
  safeCopyError,
  verifyApprovedCopy,
  type CopyStage,
} from './verify-copy';
const fixture = JSON.parse(
  await readFile('tests/fixtures/approved-copy-replay.json', 'utf8'),
);
const origin = 'http://127.0.0.1:4174';
const browser = await chromium.launch();
let stage: CopyStage = 'navigate';
let reviews = 0,
  approvals = 0;
let result;
try {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin,
  });
  const page = await context.newPage();
  await page.route('**/api/session', (r) =>
    r.fulfill({ json: { authenticated: true } }),
  );
  await page.route('**/api/agent', (r) => {
    reviews++;
    return r.fulfill({
      json: { result: fixture.result, digest: fixture.digest },
    });
  });
  await page.route('**/api/agent/approve', (r) => {
    approvals++;
    return r.fulfill({ json: fixture.approved });
  });
  // Reject external traffic; this replay must never dispatch inference or GitHub.
  await page.route(/^(?!http:\/\/127\.0\.0\.1:4174\/)/, (r) => r.abort());
  await page.goto(origin);
  stage = 'review-replay';
  await page
    .getByLabel('Public pull request URL')
    .fill(fixture.result.capture.url);
  await page.getByRole('link', { name: 'Open AI review' }).click();
  await page.getByLabel('Private review access code').fill('local-replay-only');
  await page.getByRole('button', { name: 'Unlock live reviews' }).click();
  await page
    .getByRole('button', { name: 'Run AI review', exact: true })
    .click();
  stage = 'approve-replay';
  await page
    .locator('#ai-review')
    .getByRole('button', { name: /I reviewed these findings/ })
    .click();
  result = await verifyApprovedCopy(page, fixture.approved.markdown, origin);
} catch (error) {
  result = { passed: false, error: safeCopyError(stage, error) };
} finally {
  await browser.close();
}
const safe = {
  ...result,
  replayOnly: true,
  nativeDispatches: 0,
  liveGitHubRequests: 0,
  publicationPerformed: false,
  reviews,
  approvals,
};
await mkdir('artifacts/copy-repro', { recursive: true });
await writeFile(
  'artifacts/copy-repro/corrected-diagnostic.json',
  JSON.stringify(safe, null, 2),
);
console.log(JSON.stringify(safe));
if (!result?.passed || reviews !== 1 || approvals !== 1) process.exitCode = 1;
