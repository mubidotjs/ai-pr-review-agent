import { chromium, type CDPSession } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { cpus } from 'node:os';
import {
  benchmarkCases,
  makePerformanceInput,
} from '../tests/performance-fixtures';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
// tsx preserves function names in serialized Playwright evaluate callbacks.
await page.addInitScript('globalThis.__name = (value) => value;');
const workerFile = readdirSync('dist/client/assets').find((n) =>
  /^review\.worker-.*\.js$/.test(n),
)!;
const bundle = readFileSync(`dist/client/assets/${workerFile}`);
const root = await browser.newBrowserCDPSession();
let commandId = 0;
const pending = new Map<
  number,
  { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
>();
root.on('Target.receivedMessageFromTarget', ({ message }) => {
  const event = JSON.parse(message);
  const task = pending.get(event.id);
  if (!task) return;
  pending.delete(event.id);
  if (event.error) task.reject(new Error(JSON.stringify(event.error)));
  else task.resolve(event.result);
});
function call(session: string, method: string, params = {}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    void root
      .send('Target.sendMessageToTarget', {
        sessionId: session,
        message: JSON.stringify({ id, method, params }),
      })
      .catch(reject);
  });
}
const stats = (values: number[]) => {
  values.sort((a, b) => a - b);
  return {
    median: values[Math.floor(values.length / 2)],
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values.at(-1)!,
  };
};
interface Profile {
  nodes: { id: number; callFrame: { functionName: string } }[];
  samples: number[];
  timeDeltas: number[];
}
function attributed(profile: Profile) {
  const names = new Map(
    profile.nodes.map((n) => [n.id, n.callFrame.functionName]),
  );
  return (
    profile.samples.reduce(
      (sum, id, i) =>
        sum +
        (['(idle)', '(program)', '(root)'].includes(names.get(id) ?? '')
          ? 0
          : (profile.timeDeltas[i] ?? 0)),
      0,
    ) / 1000
  );
}
try {
  await page.goto('http://127.0.0.1:4173');
  await page
    .getByRole('button', { name: 'Copy Markdown', exact: true })
    .waitFor();
  const main = await context.newCDPSession(page);
  await main.send('Performance.enable');
  const results = [];
  for (const spec of benchmarkCases) {
    const json = JSON.stringify(makePerformanceInput(spec));
    const startup = await page.evaluate(async (workerFile) => {
      const start = performance.now();
      const worker = new Worker(`/assets/${workerFile}`, {
        type: 'module',
        name: 'prism-benchmark',
      });
      (window as unknown as { bench: Worker }).bench = worker;
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.kind === 'ready') resolve();
        };
        worker.onerror = () => reject(new Error('Worker startup failed'));
      });
      return performance.now() - start;
    }, workerFile);
    const targets = await root.send('Target.getTargets');
    const target = targets.targetInfos.find(
      (t) => t.type === 'worker' && t.url.endsWith(workerFile),
    );
    if (!target) throw new Error('Benchmark Worker target not found');
    const { sessionId } = await root.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: false,
    });
    await call(sessionId, 'Profiler.enable');
    await call(sessionId, 'Profiler.setSamplingInterval', { interval: 100 });
    const before = await call(sessionId, 'Runtime.getHeapUsage');
    await call(sessionId, 'Profiler.start');
    const mainBefore = await main.send('Performance.getMetrics');
    const measurements = await page.evaluate(
      async ({ json }) => {
        const worker = (window as unknown as { bench: Worker }).bench;
        const object = JSON.parse(json);
        const bytes = new TextEncoder().encode(json);
        const beats: number[] = [],
          longTasks: number[] = [];
        let previous = performance.now();
        let frames = 0;
        const timer = setInterval(() => {
          const now = performance.now();
          beats.push(now - previous);
          previous = now;
        }, 5);
        let alive = true;
        const frame = () => {
          if (alive) {
            frames++;
            requestAnimationFrame(frame);
          }
        };
        requestAnimationFrame(frame);
        const observer = new PerformanceObserver((entries) =>
          longTasks.push(...entries.getEntries().map((e) => e.duration)),
        );
        observer.observe({ type: 'longtask' });
        const runs = [];
        for (let i = 0; i < 8; i++) {
          const transfer = i !== 7;
          const buffer = bytes.slice().buffer;
          const id = `bench-${i}`;
          const result = await new Promise<{
            kind: string;
            timings: {
              receivedAt: number;
              analysisMs: number;
              decodeMs: number;
              sentAt: number;
            };
            review: { coverage: { analyzed: number }; findings: unknown[] };
          }>((resolve, reject) => {
            worker.onmessage = ({ data }) => {
              if (data.id !== id) return;
              if (data.kind === 'error') reject(new Error(data.message));
              else if (data.kind === 'result') resolve(data);
            };
            const begin = performance.now(),
              absolute = performance.timeOrigin + begin;
            worker.postMessage(
              { kind: 'snapshot', id, input: transfer ? buffer : object },
              transfer ? [buffer] : [],
            );
            (
              window as unknown as {
                sent: { begin: number; absolute: number; blocking: number };
              }
            ).sent = { begin, absolute, blocking: performance.now() - begin };
          });
          const end = performance.now(),
            sent = (
              window as unknown as {
                sent: { begin: number; absolute: number; blocking: number };
              }
            ).sent;
          runs.push({
            elapsedMs: end - sent.begin,
            analysisMs: result.timings.analysisMs,
            decodeMs: result.timings.decodeMs,
            inputDeliveryMs: result.timings.receivedAt - sent.absolute,
            outputDeliveryMs:
              performance.timeOrigin + end - result.timings.sentAt,
            postMessageBlockingMs: sent.blocking,
            transfer,
            analyzed: result.review.coverage.analyzed,
            findings: result.review.findings.length,
          });
        }
        alive = false;
        clearInterval(timer);
        observer.disconnect();
        return {
          runs,
          heartbeatGapsMs: beats,
          animationFrames: frames,
          longTasksMs: longTasks,
        };
      },
      { json },
    );
    const mainAfter = await main.send('Performance.getMetrics');
    const { profile } = (await call(sessionId, 'Profiler.stop')) as unknown as {
      profile: Profile;
    };
    const after = await call(sessionId, 'Runtime.getHeapUsage');
    await call(sessionId, 'HeapProfiler.collectGarbage');
    const afterGc = await call(sessionId, 'Runtime.getHeapUsage');
    const task = (session: Awaited<ReturnType<CDPSession['send']>>) =>
      (session as { metrics: { name: string; value: number }[] }).metrics.find(
        (m) => m.name === 'TaskDuration',
      )?.value ?? 0;
    const warm = measurements.runs.slice(2, 7);
    const result = {
      ...spec,
      inputBytes: Buffer.byteLength(json),
      startupMs: startup,
      cold: measurements.runs[0],
      warm: {
        analysisMs: stats(warm.map((r) => r.analysisMs)),
        elapsedMs: stats(warm.map((r) => r.elapsedMs)),
        postMessageBlockingMs: stats(warm.map((r) => r.postMessageBlockingMs)),
        inputDeliveryMs: stats(warm.map((r) => r.inputDeliveryMs)),
        outputDeliveryMs: stats(warm.map((r) => r.outputDeliveryMs)),
      },
      structuredClone: measurements.runs[7],
      attributedWorkerSampleMs: attributed(profile),
      mainThreadTaskMs: (task(mainAfter) - task(mainBefore)) * 1000,
      heartbeatGapMs: stats(measurements.heartbeatGapsMs),
      animationFrames: measurements.animationFrames,
      longTasksMs: measurements.longTasksMs,
      heapBytes: { before, after, afterGc },
    };
    if (
      measurements.runs.some(
        (r) => r.analyzed !== spec.files || r.findings < spec.files,
      )
    )
      throw new Error(`Parity failed: ${spec.name}`);
    results.push(result);
    console.log(
      `${spec.name}: browser analysis p95 ${result.warm.analysisMs.p95.toFixed(2)} ms; main task ${result.mainThreadTaskMs.toFixed(2)} ms; heartbeat max ${result.heartbeatGapMs.max.toFixed(2)} ms`,
    );
    await root.send('Target.detachFromTarget', { sessionId });
    await page.evaluate(() => {
      (window as unknown as { bench: Worker }).bench.terminate();
      delete (window as unknown as { bench?: Worker }).bench;
    });
  }
  writeFileSync(
    'docs/milestone-2-browser-results.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        browser: browser.version(),
        cpu: cpus()[0].model,
        workerBundle: {
          rawBytes: bundle.byteLength,
          gzipBytes: gzipSync(bundle).byteLength,
        },
        method:
          'Built native browser Worker via Vite. Each scenario starts a fresh Worker and records cold first run, five warm runs after two first/warmup runs, and a separate structured-clone run. Production terminates per review; warm reuse is diagnostic. Worker elapsed timestamps, main-thread CDP TaskDuration, 5ms heartbeat and animation frames; V8 attributed CPU samples at requested 100us for whole batch. Heap points before/after and after forced GC are not peak RSS. Profiler and CDP overhead affect measurements. Synthetic inputs only; no external requests.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await root.detach();
  await browser.close();
}
