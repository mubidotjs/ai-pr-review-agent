import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import type { ReviewInputSnapshot } from '../src/shared/types';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PR_URL } from '../tests/upstream-fixtures';
import WebSocket from 'ws';
import { benchmarkCases } from '../tests/performance-fixtures';

// Connects only to a separately started, local synthetic Worker harness.
const origin = 'http://127.0.0.1:8787';
const targets = (await (await fetch('http://127.0.0.1:9229/json')).json()) as {
  webSocketDebuggerUrl: string;
}[];
const socket = new WebSocket(targets[0].webSocketDebuggerUrl, {
  headers: { Origin: 'http://127.0.0.1:9229' },
});
await new Promise<void>((resolve, reject) => {
  socket.onopen = () => resolve();
  socket.onerror = () => reject(new Error('Local inspector unavailable'));
});
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>();
socket.onmessage = (event) => {
  const result = JSON.parse(String(event.data));
  if (result.id && pending.has(result.id)) {
    const task = pending.get(result.id)!;
    pending.delete(result.id);
    if (result.error) task.reject(new Error(JSON.stringify(result.error)));
    else task.resolve(result.result);
  }
};
const command = (method: string, params = {}) =>
  new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
interface Profile {
  nodes: { id: number; callFrame: { functionName: string; url: string } }[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}
try {
  await command('Profiler.enable');
  await command('Profiler.setSamplingInterval', { interval: 100 });
  const results = [];
  mkdirSync('artifacts', { recursive: true });
  for (const scenario of ['normal', ...benchmarkCases.map((s) => s.name)]) {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      await command('Profiler.start');
      const start = performance.now();
      const response = await fetch(`${origin}/api/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-benchmark': scenario,
        },
        body: JSON.stringify({ url: PR_URL }),
      });
      const wire = await response.arrayBuffer();
      const review = decodeSnapshotWire(wire) as ReviewInputSnapshot;
      const wallMs = performance.now() - start;
      if (
        !response.ok ||
        !review.verification.after ||
        review.files.filter((file: { context?: unknown }) => file.context)
          .length !==
          (scenario === 'normal'
            ? 5
            : benchmarkCases.find((s) => s.name === scenario)!.files)
      )
        throw new Error(`Worker scenario failed: ${JSON.stringify(review)}`);
      const { profile } = (await command('Profiler.stop')) as {
        profile: Profile;
      };
      writeFileSync(
        `artifacts/worker-${scenario}-${i}.cpuprofile`,
        JSON.stringify(profile),
      );
      const frames = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
      let attributedMicros = 0;
      for (let s = 0; s < profile.samples.length; s++) {
        const name = frames.get(profile.samples[s])?.functionName;
        if (name && !['(idle)', '(program)', '(root)'].includes(name))
          attributedMicros += profile.timeDeltas[s] ?? 0;
      }
      runs.push({
        wallMs,
        attributedSampleMs: attributedMicros / 1000,
        samples: profile.samples.length,
        contextFiles: review.files.filter(
          (file: { context?: unknown }) => file.context,
        ).length,
        responseBytes: wire.byteLength,
        requests: review.budget.requests,
      });
    }
    results.push({ scenario, runs });
    console.log(
      `${scenario}:`,
      runs.map((r) => ({
        wallMs: r.wallMs.toFixed(2),
        attributedSampleMs: r.attributedSampleMs.toFixed(2),
      })),
    );
  }
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/milestone-2-backend-profile.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        method:
          'Local workerd inspector V8 sampling at requested 100 us interval over complete mocked ingestion/serialization-only /api/review invocations; 5 sequential runs, first cold. Attributed sample time excludes idle/program/root leaf frames. Sampling is diagnostic, not authoritative invocation CPU. Network uses in-Worker fixtures, no GitHub or cloud calls. Do not compare wall time directly to Cloudflare CPU enforcement.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  socket.close();
}
