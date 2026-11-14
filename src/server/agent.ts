import type { LIMITS, Finding, PullRequest, ReviewFile } from '../shared/types';
import type { GitHubClient } from './github';

// Local Node orchestration is deliberately not imported by either ingestion entry.
export { runAgentReview, AGENT_LIMITS } from './agent/engine';
export { MockProposalModel } from './agent/proposal-model';
export type {
  ProposalModelAdapter,
  ProposalRequest,
  ProposalResponse,
} from './agent/proposal-protocol';
export type { Candidate } from './agent/protocol';

// Legacy types for the disabled MVP adapter only. Never expose raw GitHubClient
// capabilities to a model. M5 uses its strict ToolCall protocol and backend-owned
// capture and one proposal call in agent/engine.ts instead.
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
