import { expect, test } from '@playwright/test';
import { createDemoInput, PR_URL } from '../fixtures';
import { serializeSnapshot } from '../../src/server/review';

test('uses the unchanged browser Worker decoder for a binary streamed-frame response', async ({
  page,
}) => {
  const input = createDemoInput();
  input.pr.title = 'Binary frame parity over Node-served UI';
  const frame = serializeSnapshot(input);
  const body = Buffer.from(await new Response(frame.body).arrayBuffer());
  await page.route('**/api/review', (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.prism.review-input.v1',
        'Cache-Control': 'no-store',
      },
      body,
    }),
  );
  await page.goto('/');
  await expect(page.getByLabel('Public pull request URL')).toBeEnabled();
  await page.getByLabel('Public pull request URL').fill(PR_URL);
  await page
    .getByRole('button', { name: 'Review pull request', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: input.pr.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('8 inventoried · 3 skipped · 0 uninventoried'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'JWT exp claim validation disabled',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('AI is disabled', { exact: true })).toBeVisible();
});

test('reaches the actual Node API and rejects an unsafe URL without GitHub requests', async ({
  request,
}) => {
  const health = await request.get('/api/health');
  expect(await health.json()).toEqual({
    status: 'ok',
    ai: 'disabled',
    runtime: 'node',
  });
  const response = await request.post('/api/review', {
    data: { url: 'https://127.0.0.1/example/repo/pull/1' },
  });
  expect(response.status()).toBe(400);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect((await response.json()).error.code).toBe('INVALID_URL');
});
