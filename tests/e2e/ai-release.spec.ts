import { test, expect } from '@playwright/test';
import { runAgentReview } from '../../src/server/agent/engine';
import { oneFindingModel, tool } from '../agent-fixtures';
import { fixtureTransport, PR_URL } from '../upstream-fixtures';

test('PRISM launch metadata and local brand assets render without external requests', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174'))
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page).toHaveTitle('PRISM — AI PR Review Agent');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://prism.mubashirhussain.dev/',
  );
  const assets = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/icon-192.png';
    await image.decode();
    const manifest = await (await fetch('/site.webmanifest')).json();
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      name: manifest.short_name,
      icons: manifest.icons.length,
    };
  });
  expect(assets).toEqual({ width: 192, height: 192, name: 'PRISM', icons: 3 });
  expect(external).toEqual([]);
});

test('mock-backed selected-validation draft, human approval and manual copy without another decision', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { result, humanApproval } = await runAgentReview(
    { url: PR_URL },
    {
      model: oneFindingModel((request) =>
        tool({
          name: 'validateReviewFinding',
          arguments: { evidenceId: request.factCards[0].evidenceId },
        }),
      ),
      transport: fixtureTransport(),
    },
  );
  expect(result.status).toBe('partial');
  expect(result.budget.modelCalls).toBe(3);
  expect(result.budget.validationChecks).toBe(3);
  expect(result.findings).toHaveLength(1);
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
  await expect(
    panel.getByRole('button', { name: 'Copy approved AI report' }),
  ).toHaveCount(0);
  await panel
    .getByRole('button', { name: /I reviewed these findings/ })
    .click();
  await expect(panel.getByLabel(/Human-approved Markdown/)).toContainText(
    'Human-approved selection',
  );
  await panel.getByRole('button', { name: 'Copy approved AI report' }).click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('Human-approved selection');
  expect(clipboard).toContain('Status: partial');
  expect(clipboard).toContain(result.findings[0].sourceUrl);
  expect(clipboard).toContain(
    'Investigation stopped after one explicit AI selection',
  );
  expect(clipboard).toContain('7 uninspected');
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
