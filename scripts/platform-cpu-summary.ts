import { readFileSync, writeFileSync } from 'node:fs';
import type { CpuMetric } from './platform-cpu-metadata';
import { CPU_CASES } from '../tests/platform-cpu-fixtures';

const report = JSON.parse(
  readFileSync('docs/milestone-2.5-platform-cpu.json', 'utf8'),
) as {
  runs: {
    scenario: string;
    serverStarted?: string;
    firstRequest: boolean;
    httpStatus: number;
    clientWallMs: number;
  }[];
  metrics: CpuMetric[];
};
const second = (date: string) =>
  new Date(Math.floor(Date.parse(date) / 1000) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
const median = (numbers: number[]) => {
  const a = [...numbers].sort((x, y) => x - y);
  return a.length % 2
    ? a[Math.floor(a.length / 2)]
    : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const results = CPU_CASES.map((scenario) => {
  const runs = report.runs.filter((r) => r.scenario === scenario);
  const metrics = report.metrics.filter((m) =>
    runs.some((r) => r.serverStarted && second(r.serverStarted) === m.datetime),
  );
  const warm = metrics.filter(
    (m) =>
      !runs.some(
        (r) =>
          r.firstRequest &&
          r.serverStarted &&
          second(r.serverStarted) === m.datetime,
      ),
  );
  const values = warm.map((m) => m.cpuTimeP99 / 1000);
  return {
    scenario,
    attempts: runs.length,
    http: runs.reduce<Record<string, number>>(
      (a, r) => ({ ...a, [r.httpStatus]: (a[r.httpStatus] ?? 0) + 1 }),
      {},
    ),
    matchedMetricGroups: metrics.length,
    warmGroups: warm.length,
    warmCpuMs: values.length
      ? {
          min: Math.min(...values),
          median: median(values),
          max: Math.max(...values),
        }
      : null,
    clientElapsedMs: {
      median: median(runs.map((r) => r.clientWallMs)),
      max: Math.max(...runs.map((r) => r.clientWallMs)),
    },
    cold: metrics.filter((m) => !warm.includes(m)),
  };
});
writeFileSync(
  'docs/milestone-2.5-cpu-summary.json',
  JSON.stringify(
    {
      method:
        'Scenario join by exact server-start UTC second. CPU values are platform-returned per-second P99 sample groups, not a raw invocation ledger. Warm min/median/max summarize returned groups only; adaptive estimated request weights are not treated as extra measured invocations.',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(results, null, 2));
