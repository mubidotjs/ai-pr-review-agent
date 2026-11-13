export const LIMITS = {
  bodyBytes: 2048,
  files: 100,
  requests: 12,
  requestMs: 8000,
  durationMs: 30000,
  responseBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  patchBytes: 128 * 1024,
  sourceBytes: 128 * 1024,
  contextFiles: 6,
  diffLines: 10000,
  findings: 100,
  snapshotBytes: 12 * 1024 * 1024,
  analysisResultBytes: 24 * 1024 * 1024,
  analysisMs: 30000,
} as const;

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  url: string;
}
export interface RepositoryRef {
  fullName: string;
  private: boolean;
}
export interface PullRequest extends PullRequestRef {
  title: string;
  description: string;
  state: string;
  author: string;
  baseSha: string;
  headSha: string;
  headRepo: RepositoryRef | null;
  changedFiles: number;
  additions: number;
  deletions: number;
}
export interface DiffRow {
  kind: 'add' | 'delete' | 'context' | 'hunk' | 'note';
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
export interface ReviewFile extends Omit<ChangedFile, 'patch'> {
  githubUrl?: string;
  rows: DiffRow[];
  reviewStatus: 'analyzed' | 'skipped';
  reason?: string;
}
export interface Finding {
  id: string;
  source: 'deterministic' | 'ai';
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  explanation: string;
  recommendation: string;
  path: string;
  line: number;
  evidence: string;
  sourceUrl: string;
}
export interface RateLimit {
  limit?: number;
  remaining?: number;
  used?: number;
  resetAt?: number;
  retryAt?: number;
  resource?: string;
}
export type ReviewStage =
  | 'validate'
  | 'fetch'
  | 'parse'
  | 'analyze'
  | 'validate-findings'
  | 'complete'
  | 'partial'
  | 'failed';
export interface Review {
  provenance?: { analysis: 'browser-worker'; serverAttested: false };
  pr: PullRequest;
  files: ReviewFile[];
  findings: Finding[];
  coverage: {
    total: number;
    inventoried: number;
    analyzed: number;
    skipped: number;
    uninventoried: number;
  };
  status: 'complete' | 'partial';
  snapshotVerified: boolean;
  notices: string[];
  stages: ReviewStage[];
  budget: {
    requests: number;
    bytes: number;
    contextFiles: number;
    diffLines: number;
    durationMs: number;
  };
  rateLimit: RateLimit;
  ai: { status: 'disabled'; reason: string };
  synthetic?: boolean;
}
export const AI_DISABLED = {
  status: 'disabled' as const,
  reason:
    'No model configured. No inference performed. Deterministic findings only.',
};
export interface SnapshotIdentity {
  baseSha: string;
  headSha: string;
  changedFiles: number;
  headRepo: string | null;
}
export interface ReviewInputFile extends ChangedFile {
  patchOmitted?: 'oversized';
  contextReason?: string;
  context?: { repository: string; sha: string; path: string; text: string };
}
export interface ReviewInputSnapshot {
  schemaVersion: 1;
  id: string;
  pr: PullRequest;
  files: ReviewInputFile[];
  verification: { before: SnapshotIdentity; after: SnapshotIdentity | null };
  notices: string[];
  budget: Review['budget'];
  rateLimit: RateLimit;
  synthetic?: boolean;
}
