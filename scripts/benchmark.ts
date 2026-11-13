import { cpuUsage, hrtime, versions } from 'node:process';
import { cpus, platform, arch } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { analyzeFile } from '../src/server/rules';
import { parseDiff } from '../src/server/diff';
import { addition, benchmarkSource, pr } from '../tests/fixtures';

const child = process.argv.includes('--child');
const inputs = [16, 64, 128].flatMap((kib) =>
  [1, 6].flatMap((files) =>
    (['js', 'ts', 'tsx'] as const).map((extension) => ({
      kib,
      files,
      extension,
      pathological: false,
      largeDiff: false,
    })),
  ),
);
inputs.push({
  kib: 128,
  files: 6,
  extension: 'ts',
  pathological: true,
  largeDiff: false,
});
inputs.push({
  kib: 64,
  files: 6,
  extension: 'ts',
  pathological: false,
  largeDiff: true,
});
function run(input: (typeof inputs)[number]) {
  const source = benchmarkSource(
    input.kib,
    input.extension,
    input.pathological,
  );
  const raw = input.largeDiff
    ? addition(`source.${input.extension}`, source)
    : {
        path: `source.${input.extension}`,
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: `@@ -0,0 +1 @@\n+${source.split('\n')[0]}`,
      };
  const elapsed = hrtime.bigint(),
    cpu = cpuUsage();
  const outputs = [];
  for (let i = 0; i < input.files; i++) {
    const parsed = parseDiff(raw.patch, raw.additions, 0);
    if (!parsed.complete) throw new Error(parsed.reason);
    outputs.push(
      analyzeFile(
        { ...raw, rows: parsed.rows, reviewStatus: 'analyzed' },
        source,
        pr,
      ),
    );
  }
  const serialized = JSON.stringify(outputs);
  const used = cpuUsage(cpu);
  return {
    cpuMs: (used.user + used.system) / 1000,
    wallMs: Number(hrtime.bigint() - elapsed) / 1e6,
    bytes: Buffer.byteLength(source),
    outputBytes: serialized.length,
  };
}
if (child) {
  const input = JSON.parse(process.argv.at(-1)!) as (typeof inputs)[number];
  console.log(JSON.stringify(run(input)));
} else {
  const results = inputs.map((input) => {
    const cold = Array.from({ length: 3 }, () => {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          import.meta.filename,
          '--child',
          JSON.stringify(input),
        ],
        { encoding: 'utf8' },
      );
      if (result.status !== 0) throw new Error(result.stderr);
      return JSON.parse(result.stdout) as ReturnType<typeof run>;
    });
    for (let i = 0; i < 5; i++) run(input);
    const warm = Array.from({ length: 30 }, () => run(input));
    const stats = (values: number[]) => {
      values.sort((a, b) => a - b);
      return {
        median: values[Math.floor(values.length / 2)],
        p95: values[Math.ceil(values.length * 0.95) - 1],
        max: values.at(-1)!,
      };
    };
    const cpu = stats(warm.map((s) => s.cpuMs)),
      wall = stats(warm.map((s) => s.wallMs));
    const result = {
      ...input,
      sourceBytes: warm[0].bytes,
      coldCpu: stats(cold.map((s) => s.cpuMs)),
      coldWall: stats(cold.map((s) => s.wallMs)),
      warmCpu: cpu,
      warmWall: wall,
      adjustmentRequired:
        cpu.p95 > 5 || Math.max(cpu.max, ...cold.map((s) => s.cpuMs)) > 10,
    };
    console.log(
      `${input.files} × ${input.kib} KiB ${input.extension}${input.pathological ? ' nested' : ''}: CPU p95 ${cpu.p95.toFixed(2)} ms; wall p95 ${wall.p95.toFixed(2)} ms`,
    );
    return result;
  });
  mkdirSync('docs', { recursive: true });
  writeFileSync(
    'docs/benchmark-results.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        node: process.version,
        v8: versions.v8,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        method:
          'Isolated Node process.cpuUsage user+system around diff parsing, Babel analysis, evidence validation, and JSON serialization; 3 fresh-process cold samples and 30 warm samples after 5 warmups. Inputs prepared outside timing. Not Cloudflare invocation CPU or deployment verification.',
        results,
      },
      null,
      2,
    ) + '\n',
  );
}
