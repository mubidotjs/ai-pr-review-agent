import {
  AI_DISABLED,
  LIMITS,
  type Review,
  type ReviewFile,
} from '../shared/types';
import { parseDiff } from './diff';
import { GitHubClient } from './github';
import {
  analyzeFile,
  createReviewFinding,
  validateReviewFinding,
} from './rules';
import {
  parsePullRequestUrl,
  ReviewError,
  safePath,
  sourceFileUrl,
} from './security';

export interface ReviewTools {
  getPullRequest: GitHubClient['getPullRequest'];
  listChangedFiles: GitHubClient['listChangedFiles'];
  readFileContext: GitHubClient['readFileContext'];
  createReviewFinding: typeof createReviewFinding;
  validateReviewFinding: typeof validateReviewFinding;
}
export interface FutureAiAdapter {
  review(
    tools: ReviewTools,
    budget: typeof LIMITS,
  ): Promise<{ status: 'disabled'; findings: never[] }>;
}
export const disabledAiAdapter: FutureAiAdapter = {
  async review() {
    return { status: 'disabled', findings: [] };
  },
};
const message = (error: unknown) =>
  error instanceof ReviewError
    ? `${error.code}: ${error.message}`
    : 'Unexpected analysis failure; no speculative findings.';

export async function reviewPullRequest(
  url: string,
  client = new GitHubClient(),
): Promise<Review> {
  const ref = parsePullRequestUrl(url);
  await client.verifyPublicRepository(ref);
  const pr = await client.getPullRequest(ref);
  const review: Review = {
    pr,
    files: [],
    findings: [],
    coverage: {
      total: pr.changedFiles,
      inventoried: 0,
      analyzed: 0,
      skipped: 0,
      uninventoried: pr.changedFiles,
    },
    status: 'partial',
    snapshotVerified: false,
    notices: [],
    stages: ['validate', 'fetch'],
    budget: {
      requests: 0,
      bytes: 0,
      contextFiles: 0,
      diffLines: 0,
      durationMs: 0,
    },
    rateLimit: {},
    ai: AI_DISABLED,
  };
  const rawFiles = [];
  try {
    for (let page = 1; page <= 2 && rawFiles.length < pr.changedFiles; page++) {
      const files = await client.listChangedFiles(ref, page);
      rawFiles.push(...files);
      if (files.length < 50) break;
    }
  } catch (error) {
    review.notices.push(message(error));
  }
  if (
    rawFiles.length > pr.changedFiles ||
    new Set(rawFiles.map((f) => f.path)).size !== rawFiles.length
  )
    throw new ReviewError(
      'INCONSISTENT_INVENTORY',
      'File inventory is inconsistent; retry a fresh snapshot.',
      409,
    );
  review.stages.push('parse');
  for (const raw of rawFiles) {
    const parsed = parseDiff(
      raw.patch,
      raw.additions,
      raw.deletions,
      LIMITS.diffLines - review.budget.diffLines,
    );
    review.budget.diffLines += parsed.lineCount;
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
      reason: parsed.reason,
    };
    if (!safePath(file.path)) file.reason = 'Unsupported or unsafe file path.';
    else if (file.status === 'removed')
      file.reason = 'Deleted file; no head source or added-line analysis.';
    else if (
      !['added', 'modified', 'renamed', 'copied', 'changed'].includes(
        file.status,
      )
    )
      file.reason = 'Unsupported GitHub file status.';
    else if (!/\.[cm]?[jt]sx?$/.test(file.path))
      file.reason = 'Language unsupported by the current JS/TS rules.';
    else if (!pr.headRepo)
      file.reason =
        'Head repository unavailable; pinned context cannot be retrieved.';
    else if (!file.rows.some((r) => r.kind === 'add'))
      file.reason = 'No added lines available for these rules.';
    review.files.push(file);
  }
  review.stages.push('analyze');
  for (const file of review.files) {
    if (file.reason) continue;
    if (review.budget.contextFiles >= LIMITS.contextFiles) {
      file.reason = 'Six-file source-context budget reached.';
      continue;
    }
    try {
      client.assertBudget();
      // Preserve the last known quota unit for mandatory snapshot verification.
      if (
        client.rateLimit.remaining !== undefined &&
        client.rateLimit.remaining <= 1
      ) {
        file.reason =
          'Remaining GitHub quota reserved for snapshot verification.';
        continue;
      }
      review.budget.contextFiles++;
      const source = await client.readFileContext(pr, file.path);
      const result = analyzeFile(file, source, pr);
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
    } catch (error) {
      file.reason = message(error);
    }
  }
  review.stages.push('validate-findings');
  try {
    const current = await client.getPullRequest(ref, true);
    if (
      current.baseSha !== pr.baseSha ||
      current.headSha !== pr.headSha ||
      current.changedFiles !== pr.changedFiles ||
      current.headRepo?.fullName !== pr.headRepo?.fullName
    )
      throw new ReviewError(
        'PR_CHANGED',
        'PR snapshot changed during review. Run a fresh review.',
        409,
      );
    review.snapshotVerified = true;
  } catch (error) {
    if (error instanceof ReviewError && error.code === 'PR_CHANGED')
      throw error;
    review.notices.push(
      `Final snapshot verification unavailable. ${message(error)}`,
    );
    review.findings = [];
    for (const file of review.files)
      if (file.reviewStatus === 'analyzed') {
        file.reviewStatus = 'skipped';
        file.reason =
          'Final snapshot consistency could not be verified; findings suppressed.';
      }
  }
  const inventoried = review.files.length;
  const analyzed = review.files.filter(
    (f) => f.reviewStatus === 'analyzed',
  ).length;
  review.coverage = {
    total: pr.changedFiles,
    inventoried,
    analyzed,
    skipped: inventoried - analyzed,
    uninventoried: pr.changedFiles - inventoried,
  };
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
  review.budget = {
    ...review.budget,
    requests: client.requests,
    bytes: client.bytes,
    durationMs: Date.now() - client.started,
  };
  review.rateLimit = { ...client.rateLimit };
  return review;
}
