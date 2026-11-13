import type { ChangedFile, PullRequest } from './types';
import { safePath } from './source';
export function ineligibleReason(
  file: ChangedFile,
  pr: PullRequest,
  patchReason?: string,
): string | undefined {
  if (!safePath(file.path)) return 'Unsupported or unsafe file path.';
  if (file.status === 'removed')
    return 'Deleted file; no head source or added-line analysis.';
  if (
    !['added', 'modified', 'renamed', 'copied', 'changed'].includes(file.status)
  )
    return 'Unsupported GitHub file status.';
  if (!/\.[cm]?[jt]sx?$/.test(file.path))
    return 'Language unsupported by the current JS/TS rules.';
  if (!pr.headRepo)
    return 'Head repository unavailable; pinned context cannot be retrieved.';
  if (patchReason) return patchReason;
  if (file.additions === 0) return 'No added lines available for these rules.';
}
export function identity(pr: PullRequest) {
  return {
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    changedFiles: pr.changedFiles,
    headRepo: pr.headRepo?.fullName ?? null,
  };
}
