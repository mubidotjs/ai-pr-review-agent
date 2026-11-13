import { z } from 'zod';
import {
  LIMITS,
  type ChangedFile,
  type PullRequest,
  type PullRequestRef,
  type RateLimit,
} from '../shared/types';
import { boundedText, repoPath, ReviewError, safePath } from './security';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const repository = z.object({
  full_name: z.string().max(141),
  private: z.boolean(),
});
const sha = z.string().regex(/^[a-f\d]{40}$/i);
const pullRequest = z.object({
  number: count,
  title: z.string().max(16384),
  body: z.string().max(262144).nullable(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  user: z.object({ login: z.string().max(100) }).nullable(),
  base: z.object({ sha, repo: repository }),
  head: z.object({ sha, repo: repository.nullable() }),
  changed_files: count,
  additions: count,
  deletions: count,
});
const changedFile = z.object({
  filename: z.string().max(2048),
  previous_filename: z.string().max(2048).optional(),
  status: z.string().max(40),
  additions: count,
  deletions: count,
  patch: z.string().optional(),
});
export type Transport = (input: string, init: RequestInit) => Promise<Response>;
export class GitHubClient {
  requests = 0;
  bytes = 0;
  rateLimit: RateLimit = {};
  readonly started: number;
  private deadline: number;
  private blocked = false;
  private signal: AbortSignal;
  private active = 0;
  constructor(
    private transport: Transport = (input, init) => fetch(input, init),
    signal?: AbortSignal,
    private now: () => number = Date.now,
  ) {
    this.started = now();
    this.deadline = this.started + LIMITS.durationMs;
    this.signal = signal ?? new AbortController().signal;
  }
  assertBudget(final = false): void {
    if (this.signal.aborted)
      throw new ReviewError('CANCELLED', 'Review cancelled.', 499);
    if (this.now() >= this.deadline)
      throw new ReviewError(
        'TIME_LIMIT',
        'Review exceeded the 30-second wall-time budget.',
        504,
      );
    if (this.bytes >= LIMITS.totalBytes)
      throw new ReviewError(
        'TOTAL_BYTE_LIMIT',
        'Aggregate response byte budget exhausted.',
        413,
      );
    if (this.blocked)
      throw new ReviewError(
        'RATE_LIMITED',
        'GitHub rate limit reached. Retry manually after the displayed cooldown.',
        429,
      );
    if (this.requests >= LIMITS.requests - (final ? 0 : 1))
      throw new ReviewError(
        'REQUEST_LIMIT',
        'Request budget reached; final verification reserved.',
        429,
      );
  }
  private captureRate(response: Response): void {
    const number = (key: string) => {
      const value = response.headers.get(key);
      return value !== null &&
        /^\d+$/.test(value) &&
        Number.isSafeInteger(Number(value))
        ? Number(value)
        : undefined;
    };
    const headers: RateLimit = {
      limit: number('x-ratelimit-limit'),
      remaining: number('x-ratelimit-remaining'),
      used: number('x-ratelimit-used'),
      resetAt: number('x-ratelimit-reset'),
      resource: response.headers.get('x-ratelimit-resource') ?? undefined,
    };
    for (const [key, value] of Object.entries(headers))
      if (value !== undefined) Object.assign(this.rateLimit, { [key]: value });
    const after = response.headers.get('retry-after');
    if (after) {
      const delay = /^\d+$/.test(after)
        ? this.now() + Number(after) * 1000
        : Date.parse(after);
      if (Number.isFinite(delay))
        this.rateLimit.retryAt = Math.ceil(delay / 1000);
    }
    if (headers.remaining === 0) this.blocked = true;
  }
  async request(
    path: string,
    maxBytes = LIMITS.responseBytes as number,
    raw = false,
    final = false,
  ): Promise<string> {
    this.assertBudget(final);
    if (!path.startsWith('/repos/') || /[\r\n#\\]/.test(path))
      throw new ReviewError('INVALID_API_PATH', 'Rejected unsafe API path.');
    if (this.active >= 2)
      throw new ReviewError(
        'CONCURRENCY_LIMIT',
        'Upstream concurrency limit exceeded.',
        429,
      );
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      abort,
      Math.min(LIMITS.requestMs, this.deadline - this.now()),
    );
    this.requests++;
    this.active++;
    try {
      const response = await this.transport(`https://api.github.com${path}`, {
        method: 'GET',
        // workerd supports manual/follow, but not the Fetch redirect:error mode.
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: raw
            ? 'application/vnd.github.raw+json'
            : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'ai-pr-review-agent-local-mvp',
        },
      });
      this.captureRate(response);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new ReviewError(
          'REDIRECT_REJECTED',
          'GitHub redirects are not followed. Use the current canonical public repository URL.',
          502,
        );
      }
      const text = await boundedText(
        response,
        maxBytes,
        (size) => {
          this.bytes += size;
          if (this.bytes > LIMITS.totalBytes)
            throw new ReviewError(
              'TOTAL_BYTE_LIMIT',
              'Aggregate response byte budget exceeded.',
              413,
            );
          if (this.now() >= this.deadline)
            throw new ReviewError(
              'TIME_LIMIT',
              'Review wall-time budget exceeded.',
              504,
            );
        },
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new ReviewError('TIME_LIMIT', 'GitHub request timed out.', 504);
      if (
        response.status === 429 ||
        (response.status === 403 &&
          (this.blocked ||
            response.headers.has('retry-after') ||
            /rate limit|abuse detection|secondary.*limit/i.test(text)))
      ) {
        this.blocked = true;
        this.rateLimit.retryAt ??=
          this.rateLimit.remaining === 0 && this.rateLimit.resetAt
            ? this.rateLimit.resetAt
            : Math.ceil(this.now() / 1000) + 60;
        throw new ReviewError(
          'RATE_LIMITED',
          'GitHub rate limited this originating IP. No automatic retries will run.',
          429,
        );
      }
      if (response.status === 404)
        throw new ReviewError(
          'NOT_FOUND',
          'Public repository, PR, or pinned source was not found.',
          404,
        );
      if (!response.ok)
        throw new ReviewError(
          'GITHUB_ERROR',
          `GitHub returned HTTP ${response.status}. No automatic retry was attempted.`,
          502,
        );
      return text;
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      if (this.signal.aborted)
        throw new ReviewError('CANCELLED', 'Review cancelled.', 499);
      if (controller.signal.aborted)
        throw new ReviewError(
          'TIME_LIMIT',
          'GitHub request exceeded its strict timeout.',
          504,
        );
      throw new ReviewError(
        'NETWORK_ERROR',
        'GitHub could not be reached or returned an invalid response.',
        502,
      );
    } finally {
      clearTimeout(timer);
      this.signal.removeEventListener('abort', abort);
      this.active--;
    }
  }
  private decode<T>(text: string, schema: z.ZodType<T>): T {
    try {
      return schema.parse(JSON.parse(text));
    } catch {
      throw new ReviewError(
        'INVALID_UPSTREAM',
        'GitHub returned unexpected or incomplete data.',
        502,
      );
    }
  }
  async verifyPublicRepository(ref: PullRequestRef): Promise<void> {
    const repo = this.decode(
      await this.request(
        repoPath({ fullName: `${ref.owner}/${ref.repo}`, private: false }),
      ),
      repository,
    );
    if (
      repo.private ||
      repo.full_name.toLowerCase() !== `${ref.owner}/${ref.repo}`.toLowerCase()
    )
      throw new ReviewError(
        'NOT_PUBLIC',
        'Only the exact requested public repository is supported.',
        403,
      );
  }
  async getPullRequest(
    ref: PullRequestRef,
    final = false,
  ): Promise<PullRequest> {
    const data = this.decode(
      await this.request(
        `${repoPath({ fullName: `${ref.owner}/${ref.repo}`, private: false })}/pulls/${ref.number}`,
        LIMITS.responseBytes,
        false,
        final,
      ),
      pullRequest,
    );
    if (
      data.number !== ref.number ||
      data.base.repo.private ||
      data.base.repo.full_name.toLowerCase() !==
        `${ref.owner}/${ref.repo}`.toLowerCase()
    )
      throw new ReviewError(
        'INVALID_UPSTREAM',
        'PR repository or number did not match.',
        502,
      );
    if (data.head.repo)
      repoPath({
        fullName: data.head.repo.full_name,
        private: data.head.repo.private,
      });
    return {
      ...ref,
      title: data.title,
      description: data.body ?? '',
      state: data.merged ? 'merged' : data.state,
      author: data.user?.login ?? 'unavailable',
      baseSha: data.base.sha,
      headSha: data.head.sha,
      headRepo: data.head.repo
        ? {
            fullName: data.head.repo.full_name,
            private: data.head.repo.private,
          }
        : null,
      changedFiles: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
    };
  }
  async listChangedFiles(
    ref: PullRequestRef,
    page: number,
  ): Promise<ChangedFile[]> {
    if (!Number.isInteger(page) || page < 1 || page > 2)
      throw new ReviewError(
        'PAGE_LIMIT',
        'Only two bounded changed-file pages are supported.',
      );
    const data = this.decode(
      await this.request(
        `${repoPath({ fullName: `${ref.owner}/${ref.repo}`, private: false })}/pulls/${ref.number}/files?per_page=50&page=${page}`,
      ),
      z.array(changedFile).max(50),
    );
    return data.map((f) => ({
      path: f.filename,
      previousPath: f.previous_filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }
  async readFileContext(pr: PullRequest, path: string): Promise<string> {
    if (!pr.headRepo || !safePath(path))
      throw new ReviewError(
        'SOURCE_UNAVAILABLE',
        'Safe pinned head source is unavailable.',
      );
    return this.request(
      `${repoPath(pr.headRepo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${pr.headSha}`,
      LIMITS.sourceBytes,
      true,
    );
  }
}
