import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createDemoInput, addition, PR_URL } from '../tests/fixtures';
import { analyzeSnapshot } from '../src/analysis/review';
const input = createDemoInput();
const source = [
  'export const bug = value === NaN;',
  ...Array.from({ length: 6000 }, (_, i) => `let v${i}=1;`),
].join('\n');
const path = 'src/large.ts';
input.files = [
  {
    ...addition(path, source),
    context: {
      repository: input.pr.headRepo!.fullName,
      sha: input.pr.headSha,
      path,
      text: source,
    },
  },
];
input.pr = {
  ...input.pr,
  title: 'Synthetic 6000-line responsiveness review',
  changedFiles: 1,
  additions: 6001,
  deletions: 0,
};
input.verification.before.changedFiles = 1;
input.verification.after!.changedFiles = 1;
input.budget.contextFiles = 1;
const baselineReview = analyzeSnapshot(input).review;
const browser = await chromium.launch();
try {
  const results = [];
  for (const [name, port] of [
    ['milestone-1', 4175],
    ['milestone-2', 4173],
  ] as const) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    await page.route('**/api/review', (route) =>
      route.fulfill({ json: name === 'milestone-1' ? baselineReview : input }),
    );
    await page.goto(`http://127.0.0.1:${port}`);
    await page
      .getByRole('button', { name: 'Copy Markdown', exact: true })
      .waitFor();
    await page.evaluate(() => {
      (window as unknown as { tasks: number[] }).tasks = [];
      new PerformanceObserver((list) =>
        (window as unknown as { tasks: number[] }).tasks.push(
          ...list.getEntries().map((e) => e.duration),
        ),
      ).observe({ type: 'longtask' });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics');
    const start = performance.now();
    await page.getByLabel('Public pull request URL').fill(PR_URL);
    await page
      .getByRole('button', { name: 'Review pull request', exact: true })
      .click();
    await page
      .getByRole('heading', { name: input.pr.title, exact: true })
      .waitFor();
    const after = await cdp.send('Performance.getMetrics');
    const task = (m: typeof before) =>
      m.metrics.find((x) => x.name === 'TaskDuration')!.value;
    const result = {
      name,
      elapsedMs: performance.now() - start,
      mainThreadTaskMs: (task(after) - task(before)) * 1000,
      renderedRows: await page.locator('.diff-table tbody tr').count(),
      longTasksMs: await page.evaluate(
        () => (window as unknown as { tasks: number[] }).tasks,
      ),
    };
    results.push(result);
    console.log(result);
    await page.close();
  }
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page
    .getByRole('button', { name: 'Copy Markdown', exact: true })
    .waitFor();
  const workerFile = (await import('node:fs'))
    .readdirSync('dist/client/assets')
    .find((n) => /^review\.worker-.*\.js$/.test(n))!;
  await page.addInitScript('globalThis.__name=(fn)=>fn;');
  // This evaluate has no named local callbacks injected by tsx.
  await page.evaluate('globalThis.__name=(fn)=>fn');
  const { benchmarkCases, makePerformanceInput } =
    await import('../tests/performance-fixtures');
  const payload = JSON.stringify(
    makePerformanceInput(
      benchmarkCases.find((s) => s.name === '6x128-nested')!,
    ),
  );
  const cancellation = await page.evaluate(
    async ({ workerFile, payload }) => {
      const worker = new Worker(`/assets/${workerFile}`, { type: 'module' });
      await new Promise<void>((resolve) => {
        worker.onmessage = ({ data }) => {
          if (data.kind === 'ready') resolve();
        };
      });
      const input = new TextEncoder().encode(payload).buffer;
      await new Promise<void>((resolve) => {
        worker.onmessage = ({ data }) => {
          if (data.kind === 'progress' && data.stage === 'analyze') resolve();
        };
        worker.postMessage({ kind: 'snapshot', id: 'cancellation', input }, [
          input,
        ]);
      });
      const start = performance.now();
      worker.terminate();
      return { terminateCallMs: performance.now() - start };
    },
    { workerFile, payload },
  );
  const end = performance.now();
  for (let i = 0; i < 100 && page.workers().length; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  Object.assign(cancellation, {
    targetGoneMs: performance.now() - end,
    remainingWorkers: page.workers().length,
  });
  writeFileSync(
    'docs/milestone-2-ui-responsiveness.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        browser: browser.version(),
        method:
          'Single direct built-UI comparison on identical 6001-line synthetic file; baseline exported from verified commit into ignored artifacts, both use mocked API results/inputs. Main CDP TaskDuration includes form events, response/Worker delivery, React rendering, and layout. One run per version, diagnostic not a stable population percentile. Cancellation begins after Worker analysis-start signal during a six-file nested workload. Target disappearance is not proof of immediate OS memory reclamation.',
        results,
        cancellation,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
}
