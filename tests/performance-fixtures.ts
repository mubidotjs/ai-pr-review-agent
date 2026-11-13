import { type ReviewInputSnapshot } from '../src/shared/types';
import {
  addition,
  benchmarkSource,
  apiPr,
  BASE,
  HEAD,
  pr,
  fixtureTransport,
} from './upstream-fixtures';
export const benchmarkCases = [16, 64, 128].flatMap((kib) =>
  [1, 6].flatMap((files) =>
    (['js', 'ts', 'tsx'] as const).map((extension) => ({
      name: `${files}x${kib}-${extension}`,
      kib,
      files,
      extension,
      nested: false,
      largeDiff: false,
    })),
  ),
);
benchmarkCases.push({
  name: '6x128-nested',
  kib: 128,
  files: 6,
  extension: 'ts',
  nested: true,
  largeDiff: false,
});
benchmarkCases.push({
  name: '6x64-large-diff',
  kib: 64,
  files: 6,
  extension: 'ts',
  nested: false,
  largeDiff: true,
});
export function makePerformanceInput(
  spec: (typeof benchmarkCases)[number],
): ReviewInputSnapshot {
  const text = benchmarkSource(spec.kib, spec.extension, spec.nested);
  const files = Array.from({ length: spec.files }, (_, i) => {
    const path = `src/file${i}.${spec.extension}`;
    return {
      ...addition(path, text),
      ...(spec.largeDiff
        ? {}
        : {
            status: 'modified',
            additions: 1,
            patch: `@@ -0,0 +1 @@\n+${text.split('\n')[0]}`,
          }),
      context: { repository: pr.headRepo!.fullName, sha: HEAD, path, text },
    };
  });
  const meta = {
    ...pr,
    title: `Benchmark ${spec.name}`,
    changedFiles: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: 0,
  };
  const ref = {
    baseSha: BASE,
    headSha: HEAD,
    changedFiles: files.length,
    headRepo: pr.headRepo!.fullName,
  };
  return {
    schemaVersion: 1,
    id: `benchmark-${spec.name}`,
    pr: meta,
    files,
    verification: { before: ref, after: ref },
    notices: [],
    budget: {
      requests: files.length + 4,
      bytes: 0,
      contextFiles: files.length,
      diffLines: 0,
      durationMs: 0,
    },
    rateLimit: {},
    synthetic: true,
  };
}
export function performanceTransport(input: ReviewInputSnapshot) {
  return fixtureTransport(
    input.files,
    Object.fromEntries(input.files.map((f) => [f.path, f.context!.text])),
    apiPr({
      title: input.pr.title,
      changed_files: input.files.length,
      additions: input.pr.additions,
      deletions: 0,
    }),
  );
}
