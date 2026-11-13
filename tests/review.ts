import { ingestPullRequest } from '../src/server/review';
import { analyzeSnapshot } from '../src/analysis/review';
import type { GitHubClient } from '../src/server/github';
// Integration composition only: never imported by the production backend.
export async function reviewPullRequest(url: string, client: GitHubClient) {
  return analyzeSnapshot(await ingestPullRequest(url, client)).review;
}
