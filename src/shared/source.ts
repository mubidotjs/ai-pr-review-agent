import type { RepositoryRef } from './types';
import { ReviewError } from './errors';

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
