import {
  AI_DISABLED,
  LIMITS,
  type Review,
  type ReviewFile,
} from '../shared/types';
import { ineligibleReason } from '../shared/eligibility';
import { safePath, sourceFileUrl, byteLength } from '../shared/source';
import { ReviewError } from '../shared/errors';
import { reviewReport } from '../shared/report';
import { validateSnapshot } from './snapshot';
import { parseDiff } from './diff';
import { analyzeFile } from './rules';

export function analyzeSnapshot(input: unknown): {
  review: Review;
  markdown: string;
} {
  const started = performance.now();
  const snapshot = validateSnapshot(input),
    { pr } = snapshot;
  const review: Review = {
    pr,
    files: [],
    findings: [],
    coverage: {
      total: pr.changedFiles,
      inventoried: snapshot.files.length,
      analyzed: 0,
      skipped: snapshot.files.length,
      uninventoried: pr.changedFiles - snapshot.files.length,
    },
    status: 'partial',
    snapshotVerified: snapshot.verification.after !== null,
    notices: [...snapshot.notices],
    stages: ['validate', 'fetch', 'parse'],
    budget: { ...snapshot.budget, diffLines: 0 },
    rateLimit: snapshot.rateLimit,
    ai: AI_DISABLED,
    ...(snapshot.synthetic ? { synthetic: true } : {}),
    provenance: { analysis: 'browser-worker', serverAttested: false },
  };
  for (const raw of snapshot.files) {
    if (performance.now() - started > LIMITS.analysisMs)
      throw new ReviewError(
        'ANALYSIS_TIMEOUT',
        'Browser analysis exceeded its time budget.',
      );
    const parsed = parseDiff(
      raw.patch,
      raw.additions,
      raw.deletions,
      LIMITS.diffLines - review.budget.diffLines,
    );
    review.budget.diffLines += parsed.lineCount;
    const reason = ineligibleReason(
      raw,
      pr,
      raw.patchOmitted ? 'Patch exceeds 128 KiB.' : parsed.reason,
    );
    const file: ReviewFile = {
      githubUrl:
        safePath(raw.path) && pr.headRepo && raw.status !== 'removed'
          ? sourceFileUrl(pr.headRepo, pr.headSha, raw.path)
          : `${pr.url}/files`,
      path: raw.path,
      previousPath: raw.previousPath,
      status: raw.status,
      additions: raw.additions,
      deletions: raw.deletions,
      rows: parsed.rows,
      reviewStatus: 'skipped',
      reason,
    };
    if (!file.reason) {
      if (!review.snapshotVerified)
        file.reason =
          'Final snapshot consistency could not be verified; findings suppressed.';
      else if (!raw.context)
        file.reason =
          raw.contextReason ??
          'Pinned head context unavailable; no speculative findings.';
      else {
        let result: ReturnType<typeof analyzeFile>;
        try {
          result = analyzeFile(file, raw.context.text, pr);
        } catch {
          result = {
            findings: [],
            reason: 'Unexpected analysis failure; no speculative findings.',
          };
        }
        if (result.reason) file.reason = result.reason;
        else {
          file.reviewStatus = 'analyzed';
          const slots = LIMITS.findings - review.findings.length;
          if (result.findings.length >= slots && result.findings.length > 0)
            review.notices.push(
              'Finding output capped at 100; additional findings may have been omitted.',
            );
          review.findings.push(...result.findings.slice(0, slots));
        }
      }
    }
    review.files.push(file);
  }
  review.stages.push('analyze', 'validate-findings');
  const analyzed = review.files.filter(
    (f) => f.reviewStatus === 'analyzed',
  ).length;
  review.coverage.analyzed = analyzed;
  review.coverage.skipped -= analyzed;
  if (review.coverage.uninventoried)
    review.notices.push(
      `${review.coverage.uninventoried} changed files were not inventoried within the request/file budgets.`,
    );
  review.status =
    review.snapshotVerified &&
    analyzed === pr.changedFiles &&
    !review.notices.length
      ? 'complete'
      : 'partial';
  review.stages.push(review.status);
  const markdown = reviewReport(review);
  if (
    byteLength(JSON.stringify({ review, markdown })) >
    LIMITS.analysisResultBytes
  )
    throw new ReviewError(
      'RESULT_BYTE_LIMIT',
      'Browser review output exceeds its bounded size limit.',
    );
  return { review, markdown };
}
