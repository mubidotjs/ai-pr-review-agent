import type { PullRequestRef } from '../shared/types';
import { ReviewError } from '../shared/errors';
import { validOwner, validRepo } from '../shared/source';
export { ReviewError } from '../shared/errors';
export { boundedText } from '../shared/io';
export {
  byteLength,
  repoPath,
  safePath,
  sourceUrl,
  sourceFileUrl,
} from '../shared/source';

export function parsePullRequestUrl(input: string): PullRequestRef {
  // Validate the original representation before WHATWG URL normalization removes dot segments or default ports.
  const match =
    /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/([1-9]\d*)\/?$/.exec(
      input,
    );
  if (
    !match ||
    !validOwner(match[1]) ||
    !validRepo(match[2]) ||
    !Number.isSafeInteger(Number(match[3]))
  ) {
    throw new ReviewError(
      'INVALID_URL',
      'Use an exact public GitHub PR URL: https://github.com/owner/repository/pull/123',
    );
  }
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}
