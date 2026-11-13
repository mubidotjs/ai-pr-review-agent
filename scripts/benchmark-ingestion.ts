import { cpuUsage, hrtime } from 'node:process';
import { cpus, platform } from 'node:os';
import { writeFileSync } from 'node:fs';
import {
  benchmarkCases,
  makePerformanceInput,
  performanceTransport,
} from '../tests/performance-fixtures';
import { createApp } from '../src/server/index';
import { PR_URL } from '../tests/upstream-fixtures';

const stats = (values: number[]) => {
  values.sort((a, b) => a - b);
  return {
    median: values[Math.floor(values.length / 2)],
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values.at(-1)!,
  };
};
const results = [];
for (const spec of benchmarkCases) {
  const input = makePerformanceInput(spec),
    app = createApp(performanceTransport(input));
  const once = async () => {
    const response = await app.request('http://localhost/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PR_URL }),
    });
    if (response.status !== 200) throw new Error(await response.text());
    return (await response.arrayBuffer()).byteLength;
  };
  const coldStart = hrtime.bigint(),
    coldCpu = cpuUsage();
  const responseBytes = await once();
  const cold = cpuUsage(coldCpu);
  const coldMetrics = {
    cpuMs: (cold.user + cold.system) / 1000,
    elapsedMs: Number(hrtime.bigint() - coldStart) / 1e6,
  };
  for (let i = 0; i < 3; i++) await once();
  const runs = [];
  for (let sample = 0; sample < 10; sample++) {
    const time = hrtime.bigint(),
      cpu = cpuUsage();
    for (let batch = 0; batch < 10; batch++) await once();
    const used = cpuUsage(cpu);
    runs.push({
      cpuPerInvocationMs: (used.user + used.system) / 10000,
      elapsedPerInvocationMs: Number(hrtime.bigint() - time) / 1e7,
    });
  }
  const result = {
    ...spec,
    responseBytes,
    cold: coldMetrics,
    cpu: stats(runs.map((r) => r.cpuPerInvocationMs)),
    elapsed: stats(runs.map((r) => r.elapsedPerInvocationMs)),
  };
  results.push(result);
  console.log(
    `${spec.name}: batched Node ingestion CPU p95 ${result.cpu.p95.toFixed(2)} ms; ${responseBytes} response bytes`,
  );
}
writeFileSync(
  'docs/milestone-2-ingestion-node.json',
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: platform(),
      cpu: cpus()[0].model,
      method:
        'Hono request validation, mocked public GitHub reads, preflight selection and snapshot serialization; no ASTs or analysis. One cold sample; 3 warmups; 10 batches of 10 requests. CPU is process user+system divided by batch size to mitigate coarse Windows accounting. Includes synthetic upstream JSON creation; excludes real network/TLS, not Cloudflare invocation CPU.',
      results,
    },
    null,
    2,
  ) + '\n',
);
