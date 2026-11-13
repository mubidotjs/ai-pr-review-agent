import type { PullRequestRef, RepositoryRef } from '../shared/types';

export class ReviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).byteLength;
export function validOwner(s: string): boolean {
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(s) && !s.includes('--');
}
export function validRepo(s: string): boolean {
  return (
    /^[\w.-]{1,100}$/.test(s) && s !== '.' && s !== '..' && !s.endsWith('.git')
  );
}
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
export function safePath(path: string): boolean {
  // eslint-disable-next-line no-control-regex -- reject controls in untrusted GitHub paths
  const forbidden = /[\u0000-\u001f\u007f\\]/;
  return (
    byteLength(path) <= 2048 &&
    !forbidden.test(path) &&
    path.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
  );
}
export function repoPath(repo: RepositoryRef): string {
  const [owner, name, extra] = repo.fullName.split('/');
  if (
    repo.private ||
    !validOwner(owner ?? '') ||
    !validRepo(name ?? '') ||
    extra !== undefined
  )
    throw new ReviewError(
      'INVALID_REPOSITORY',
      'Only verified public GitHub repositories are supported.',
    );
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}
export function sourceUrl(
  repo: RepositoryRef,
  sha: string,
  path: string,
  line: number,
): string {
  repoPath(repo);
  if (
    !/^[a-f\d]{40}$/i.test(sha) ||
    !safePath(path) ||
    !Number.isSafeInteger(line) ||
    line < 1
  )
    throw new ReviewError(
      'INVALID_SOURCE',
      'Invalid pinned source coordinate.',
    );
  return `https://github.com/${repo.fullName}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${line}`;
}
export function sourceFileUrl(
  repo: RepositoryRef,
  sha: string,
  path: string,
): string {
  return sourceUrl(repo, sha, path, 1).split('#')[0];
}
export async function boundedText(
  response: Response,
  max: number,
  onChunk?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted)
    throw new ReviewError(
      'TIME_LIMIT',
      'Reading was cancelled before it started.',
      504,
    );
  if (!response.body) return '';
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted)
        throw new ReviewError(
          'TIME_LIMIT',
          'Reading the response body was cancelled or timed out.',
          504,
        );
      if (done) break;
      size += value.byteLength;
      onChunk?.(value.byteLength);
      if (size > max)
        throw new ReviewError(
          'BYTE_LIMIT',
          'Response exceeds the bounded byte limit.',
          413,
        );
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
