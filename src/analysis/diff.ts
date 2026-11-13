import { scanPatch } from '../shared/patch';
import { LIMITS } from '../shared/types';
export type { ParsedDiff } from '../shared/patch';
export function parseDiff(
  patch: string | undefined,
  additions: number,
  deletions: number,
  remaining = LIMITS.diffLines as number,
) {
  return scanPatch(patch, additions, deletions, remaining, true);
}
