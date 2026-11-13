import type { LIMITS, Finding, PullRequest, ReviewFile } from '../shared/types';
import type { GitHubClient } from './github';

// Future server validation must independently reacquire/revalidate trusted evidence.
// This milestone never accepts browser findings as server-attested evidence.
export interface ReviewTools {
  getPullRequest: GitHubClient['getPullRequest'];
  listChangedFiles: GitHubClient['listChangedFiles'];
  readFileContext: GitHubClient['readFileContext'];
  createReviewFinding(
    candidate: Finding,
    file: ReviewFile,
    pinnedSource: string,
    snapshot: PullRequest,
  ): Finding | undefined;
  validateReviewFinding(
    candidate: Finding,
    file: ReviewFile,
    pinnedSource: string,
    snapshot: PullRequest,
  ): boolean;
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
