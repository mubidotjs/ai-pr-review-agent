import {
  AI_DISABLED,
  type Review,
  type ReviewFile,
  type ReviewInputSnapshot,
} from '../src/shared/types';
import { parseDiff } from '../src/analysis/diff';
import { analyzeFile } from '../src/analysis/rules';
import {
  HEAD,
  BASE,
  pr,
  sources,
  demoFiles,
  addition,
} from './upstream-fixtures';
export * from './upstream-fixtures';

export function parsedFile(path: string, source: string): ReviewFile {
  const raw = addition(path, source),
    parsed = parseDiff(raw.patch, raw.additions, raw.deletions);
  return {
    path,
    status: raw.status,
    additions: raw.additions,
    deletions: raw.deletions,
    rows: parsed.rows,
    reviewStatus: 'analyzed',
  };
}
export function createDemo(): Review {
  const files = demoFiles.map((f) => {
    const parsed = parseDiff(f.patch, f.additions, f.deletions);
    return {
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      rows: parsed.rows,
      reviewStatus: 'skipped' as const,
      reason: parsed.reason,
    } as ReviewFile;
  });
  const findings = files.flatMap((file) => {
    if (file.path === 'src/legacy.ts') {
      file.reason = 'Deleted file; no head source or added-line analysis.';
      return [];
    }
    if (file.reason || !sources[file.path]) return [];
    const result = analyzeFile(file, sources[file.path], pr);
    file.reviewStatus = 'analyzed';
    return result.findings;
  });
  return {
    pr: {
      ...pr,
      additions: demoFiles.reduce((n, f) => n + f.additions, 0),
      deletions: 1,
    },
    files,
    findings,
    coverage: {
      total: 8,
      inventoried: 8,
      analyzed: 5,
      skipped: 3,
      uninventoried: 0,
    },
    status: 'partial',
    snapshotVerified: true,
    synthetic: true,
    notices: [
      'Synthetic demonstration. Links illustrate GitHub source coordinates; this repository and PR are fictional.',
      'Limited JS/TS rules only. Binary, oversized, and deleted files are skipped.',
    ],
    stages: [
      'validate',
      'fetch',
      'parse',
      'analyze',
      'validate-findings',
      'partial',
    ],
    budget: {
      requests: 0,
      bytes: 0,
      contextFiles: 0,
      diffLines: files.reduce((n, f) => n + f.rows.length, 0),
      durationMs: 0,
    },
    rateLimit: {},
    ai: AI_DISABLED,
  };
}
export function createDemoInput(): ReviewInputSnapshot {
  const files = demoFiles.map((file) => {
    if (file.path === 'src/generated/catalog.ts')
      return { ...file, patch: undefined, patchOmitted: 'oversized' as const };
    const text = sources[file.path];
    return text && file.status !== 'removed'
      ? {
          ...file,
          context: {
            repository: pr.headRepo!.fullName,
            sha: HEAD,
            path: file.path,
            text,
          },
        }
      : { ...file };
  });
  const baseline = createDemo();
  const ref = {
    baseSha: BASE,
    headSha: HEAD,
    changedFiles: pr.changedFiles,
    headRepo: pr.headRepo!.fullName,
  };
  return {
    schemaVersion: 1,
    id: 'synthetic-demo-v1',
    pr: baseline.pr,
    files,
    verification: { before: ref, after: ref },
    notices: baseline.notices,
    budget: { ...baseline.budget, diffLines: 0, contextFiles: 5 },
    rateLimit: {},
    synthetic: true,
  };
}
