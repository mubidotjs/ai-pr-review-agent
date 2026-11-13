import { test, expect } from '@playwright/test';
import { runAgentReview } from '../../src/server/agent/engine';
import { oneFindingModel } from '../agent-fixtures';
import { fixtureTransport, PR_URL } from '../upstream-fixtures';

test('mock-backed access, evidence inspection, human approval and manual copy', async ({
  page,
}) => {
  const { result, humanApproval } = await runAgentReview(
    { url: PR_URL },
    { model: oneFindingModel(), transport: fixtureTransport() },
  );
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route('**/api/agent', (route) =>
    route.fulfill({ json: { result, digest: humanApproval.digest } }),
  );
  await page.route('**/api/agent/approve', (route) => {
    const body = route.request().postDataJSON();
    expect(body.confirm).toBe(true);
    expect(body.selectedIndexes).toEqual([0]);
    expect(body.findings).toBeUndefined();
    return route.fulfill({
      json: humanApproval.approve({
        actor: 'human',
        confirm: true,
        runId: body.runId,
        digest: body.digest,
        selectedIds: [result.findings[0].id],
      }),
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Public pull request URL')).toBeEnabled();
  await page.getByLabel('Public pull request URL').fill(PR_URL);
  await page.getByRole('link', { name: 'Open AI review' }).click();
  await page
    .getByLabel('Private review access code')
    .fill('synthetic-test-access');
  await page.getByRole('button', { name: 'Unlock live reviews' }).click();
  await page
    .getByRole('button', { name: 'Run AI review', exact: true })
    .click();
  const panel = page.locator('#ai-review');
  await expect(panel).toContainText('No confirmed real inference');
  await expect(
    panel.getByRole('link', { name: /pinned source/ }),
  ).toHaveAttribute('href', result.findings[0].sourceUrl);
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await expect(panel.getByLabel(/Human-approved Markdown/)).toHaveCount(0);
  await panel
    .getByRole('button', { name: /I reviewed these findings/ })
    .click();
  await expect(panel.getByLabel(/Human-approved Markdown/)).toContainText(
    'Human-approved selection',
  );
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
});

test('AI cancellation rejects a stale response and recovers without an automatic retry', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route('**/api/agent', async (route) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route
      .fulfill({
        status: 429,
        json: {
          error: { code: 'AI_QUOTA', message: 'Shared allowance exhausted.' },
        },
      })
      .catch(() => {});
  });
  await page.goto('/');
  await expect(page.getByLabel('Public pull request URL')).toBeEnabled();
  await page.getByLabel('Public pull request URL').fill(PR_URL);
  await page.getByRole('link', { name: 'Open AI review' }).click();
  await page.getByLabel('Private review access code').fill('synthetic');
  await page.getByRole('button', { name: 'Unlock live reviews' }).click();
  await page
    .getByRole('button', { name: 'Run AI review', exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Cancel AI request' }).click();
  await expect(page.locator('#ai-review').getByRole('alert')).toContainText(
    'Cancelled',
  );
  await page.waitForTimeout(250);
  await expect(page.locator('#ai-review').getByRole('alert')).toContainText(
    'Cancelled',
  );
  expect(calls).toBe(1);
});
