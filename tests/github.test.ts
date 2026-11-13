import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, type Transport } from '../src/server/github';
import { LIMITS } from '../src/shared/types';
import { reviewPullRequest } from './review';
import {
  addition,
  apiPr,
  demoFiles,
  fixtureTransport,
  HEAD,
  json,
  pr,
  PR_URL,
  sources,
} from './fixtures';

afterEach(() => vi.useRealTimers());
describe('bounded read-only GitHub transport', () => {
  it('uses exact REST endpoints, pinned context, no credentials, and redirect rejection', async () => {
    const transport = vi.fn(fixtureTransport());
    const review = await reviewPullRequest(PR_URL, new GitHubClient(transport));
    expect(review.coverage).toEqual({
      total: 8,
      inventoried: 8,
      analyzed: 5,
      skipped: 3,
      uninventoried: 0,
    });
    expect(review.findings).toHaveLength(3);
    expect(review.files.find((f) => f.status === 'removed')?.githubUrl).toBe(
      `${PR_URL}/files`,
    );
    expect(review.snapshotVerified).toBe(true);
    expect(review.budget.requests).toBe(9);
    for (const [url, init] of transport.mock.calls) {
      expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\//);
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('manual');
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
    }
    expect(
      transport.mock.calls
        .filter(([url]) => url.includes('/contents/'))
        .every(([url]) => url.endsWith(`?ref=${HEAD}`)),
    ).toBe(true);
  });
  it('enforces the 12-request ceiling and reserves final verification', async () => {
    const transport = vi.fn(async () => json({}));
    const client = new GitHubClient(transport);
    for (let i = 0; i < 11; i++) await client.request('/repos/x/y');
    await expect(client.request('/repos/x/y')).rejects.toMatchObject({
      code: 'REQUEST_LIMIT',
    });
    await client.request('/repos/x/y', 100, false, true);
    await expect(
      client.request('/repos/x/y', 100, false, true),
    ).rejects.toMatchObject({ code: 'REQUEST_LIMIT' });
    expect(transport).toHaveBeenCalledTimes(12);
  });
  it('stops on successful responses reporting zero remaining quota', async () => {
    const transport = vi.fn(async () =>
      json({}, 200, {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-used': '60',
        'x-ratelimit-reset': '2000000000',
      }),
    );
    const client = new GitHubClient(transport);
    await client.request('/repos/x/y');
    await expect(
      client.request('/repos/x/y', 100, false, true),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(client.rateLimit).toMatchObject({
      limit: 60,
      remaining: 0,
      used: 60,
      resetAt: 2000000000,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([403, 429])(
    'handles HTTP %s rate limits without retries',
    async (status) => {
      const transport = vi.fn(async () =>
        json({ message: 'API rate limit exceeded' }, status, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '2000000000',
        }),
      );
      const client = new GitHubClient(transport);
      await expect(client.request('/repos/x/y')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(client.rateLimit.retryAt).toBe(2000000000);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('honors secondary Retry-After and missing-header fallback', async () => {
    const client = new GitHubClient(
      async () =>
        json({ message: 'Secondary rate limit' }, 403, {
          'Retry-After': '120',
        }),
      undefined,
      () => 1000,
    );
    await expect(client.request('/repos/x/y')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(client.rateLimit.retryAt).toBe(121);
    const fallback = new GitHubClient(
      async () => json({ message: 'secondary rate limit' }, 403),
      undefined,
      () => 1000,
    );
    await expect(fallback.request('/repos/x/y')).rejects.toThrow();
    expect(fallback.rateLimit.retryAt).toBe(61);
  });
  it('handles HTTP-date Retry-After and ignores malformed counters', async () => {
    const client = new GitHubClient(async () =>
      json({ message: 'limited' }, 429, {
        'Retry-After': 'Wed, 21 Oct 2037 07:28:00 GMT',
        'x-ratelimit-remaining': '-5',
      }),
    );
    await expect(client.request('/repos/x/y')).rejects.toThrow();
    expect(client.rateLimit.retryAt).toBe(
      Date.parse('Wed, 21 Oct 2037 07:28:00 GMT') / 1000,
    );
    expect(client.rateLimit.remaining).toBeUndefined();
  });
  it.each([404, 500, 503])('handles HTTP %s failures once', async (status) => {
    const transport = vi.fn(async () => json({}, status));
    await expect(
      new GitHubClient(transport).request('/repos/x/y'),
    ).rejects.toMatchObject({
      code: status === 404 ? 'NOT_FOUND' : 'GITHUB_ERROR',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds response and aggregate bytes', async () => {
    await expect(
      new GitHubClient(async () => new Response('x'.repeat(20))).request(
        '/repos/x/y',
        10,
      ),
    ).rejects.toMatchObject({ code: 'BYTE_LIMIT' });
    const client = new GitHubClient(
      async () => new Response('x'.repeat(LIMITS.responseBytes)),
    );
    for (let i = 0; i < 4; i++) await client.request('/repos/x/y');
    await expect(client.request('/repos/x/y')).rejects.toMatchObject({
      code: 'TOTAL_BYTE_LIMIT',
    });
    expect(client.requests).toBe(4);
  });
  it('enforces wall-time and cancellation before dispatch', async () => {
    let now = 0;
    const transport = vi.fn(async () => json({}));
    const client = new GitHubClient(transport, undefined, () => now);
    now = 30000;
    await expect(client.request('/repos/x/y')).rejects.toMatchObject({
      code: 'TIME_LIMIT',
    });
    expect(transport).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new GitHubClient(transport, controller.signal).request('/repos/x/y'),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('aborts a stalled request at eight seconds', async () => {
    vi.useFakeTimers();
    const transport: Transport = (_, init) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () =>
          reject(new Error('Aborted')),
        ),
      );
    const result = new GitHubClient(transport).request('/repos/x/y');
    const assertion = expect(result).rejects.toMatchObject({
      code: 'TIME_LIMIT',
    });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
  it('allows at most two simultaneous upstream calls', async () => {
    const resolvers: ((r: Response) => void)[] = [];
    const client = new GitHubClient(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const first = client.request('/repos/x/y'),
      second = client.request('/repos/x/y');
    await expect(client.request('/repos/x/y')).rejects.toMatchObject({
      code: 'CONCURRENCY_LIMIT',
    });
    resolvers.forEach((resolve) => resolve(json({})));
    await Promise.all([first, second]);
    expect(client.requests).toBe(2);
  });
  it('rejects private/mismatched repositories and malformed API schemas', async () => {
    const ref = { owner: 'example', repo: 'checkout', number: 42, url: PR_URL };
    await expect(
      new GitHubClient(async () =>
        json({ full_name: 'example/checkout', private: true }),
      ).verifyPublicRepository(ref),
    ).rejects.toMatchObject({ code: 'NOT_PUBLIC' });
    await expect(
      new GitHubClient(async () => new Response('not json')).getPullRequest(
        ref,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM' });
    await expect(
      new GitHubClient(async () => json(apiPr({ number: 43 }))).getPullRequest(
        ref,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM' });
  });
});
describe('snapshot review orchestration', () => {
  it('paginates and accounts for uninventoried files from metadata', async () => {
    const files = Array.from({ length: 105 }, (_, i) => ({
      path: `asset${i}.png`,
      status: 'added',
      additions: 0,
      deletions: 0,
    }));
    const transport = vi.fn(
      fixtureTransport(files, {}, apiPr({ changed_files: 105 })),
    );
    const review = await reviewPullRequest(PR_URL, new GitHubClient(transport));
    expect(review.coverage).toEqual({
      total: 105,
      inventoried: 100,
      analyzed: 0,
      skipped: 100,
      uninventoried: 5,
    });
    expect(
      transport.mock.calls.filter(([url]) => url.includes('/files?')),
    ).toHaveLength(2);
    expect(review.status).toBe('partial');
  });
  it('enforces the six-context-file budget', async () => {
    const contexts = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `src/file${i}.ts`,
        `export const n${i} = true;`,
      ]),
    );
    const files = Object.entries(contexts).map(([path, source]) =>
      addition(path, source),
    );
    const review = await reviewPullRequest(
      PR_URL,
      new GitHubClient(fixtureTransport(files, contexts)),
    );
    expect(review.coverage.analyzed).toBe(6);
    expect(review.coverage.skipped).toBe(3);
    expect(review.budget.requests).toBe(10);
  });
  it('skips missing pinned context and never fabricates evidence', async () => {
    const files = [demoFiles[0]];
    const review = await reviewPullRequest(
      PR_URL,
      new GitHubClient(fixtureTransport(files, {})),
    );
    expect(review.findings).toEqual([]);
    expect(review.coverage.analyzed).toBe(0);
    expect(review.files[0].reason).toContain('NOT_FOUND');
  });
  it('skips missing head repositories and oversized source', async () => {
    const files = [demoFiles[0]];
    const missing = await reviewPullRequest(
      PR_URL,
      new GitHubClient(
        fixtureTransport(
          files,
          sources,
          apiPr({ changed_files: 1, head: { sha: HEAD, repo: null } }),
        ),
      ),
    );
    expect(missing.files[0].reason).toContain('Head repository unavailable');
    expect(missing.budget.contextFiles).toBe(0);
    const oversized = await reviewPullRequest(
      PR_URL,
      new GitHubClient(
        fixtureTransport(files, { [files[0].path]: 'x'.repeat(131073) }),
      ),
    );
    expect(oversized.coverage.analyzed).toBe(0);
    expect(oversized.files[0].reason).toContain('BYTE_LIMIT');
  });
  it('resolves renamed files from the public fork at the pinned SHA', async () => {
    const path = 'src/new-name.ts',
      source = 'export const bad = x === NaN;';
    const file = {
      ...addition(path, source),
      status: 'renamed',
      previousPath: 'src/old-name.ts',
    };
    const fixture = fixtureTransport(
      [file],
      { [path]: source },
      apiPr({
        changed_files: 1,
        head: {
          sha: HEAD,
          repo: { full_name: 'contributor/checkout', private: false },
        },
      }),
    );
    const calls: string[] = [];
    const transport: Transport = (input, init) => {
      calls.push(input);
      return fixture(
        input.replace(
          '/repos/contributor/checkout/',
          '/repos/example/checkout/',
        ),
        init,
      );
    };
    const review = await reviewPullRequest(PR_URL, new GitHubClient(transport));
    expect(
      calls.some((url) =>
        url.includes(
          `/repos/contributor/checkout/contents/src/new-name.ts?ref=${HEAD}`,
        ),
      ),
    ).toBe(true);
    expect(review.findings[0].sourceUrl).toContain(
      `contributor/checkout/blob/${HEAD}/src/new-name.ts#L1`,
    );
    expect(review.files[0].githubUrl).toBe(
      `https://github.com/contributor/checkout/blob/${HEAD}/src/new-name.ts`,
    );
  });
  it('fails cleanly when SHAs or metadata counts change', async () => {
    const fixture = fixtureTransport();
    let reads = 0;
    const transport: Transport = (input, init) =>
      input.endsWith('/pulls/42') && ++reads === 2
        ? Promise.resolve(
            json(
              apiPr({
                head: {
                  sha: 'c'.repeat(40),
                  repo: { full_name: 'example/checkout', private: false },
                },
              }),
            ),
          )
        : fixture(input, init);
    await expect(
      reviewPullRequest(PR_URL, new GitHubClient(transport)),
    ).rejects.toMatchObject({ code: 'PR_CHANGED' });
  });
  it('suppresses findings and resets analyzed coverage if final verification fails', async () => {
    const fixture = fixtureTransport();
    let reads = 0;
    const transport: Transport = (input, init) =>
      input.endsWith('/pulls/42') && ++reads === 2
        ? Promise.resolve(json({}, 503))
        : fixture(input, init);
    const review = await reviewPullRequest(PR_URL, new GitHubClient(transport));
    expect(review.findings).toEqual([]);
    expect(review.snapshotVerified).toBe(false);
    expect(review.coverage.analyzed).toBe(0);
    expect(review.coverage.skipped).toBe(8);
  });
  it('reserves remaining quota for final verification and does not retry', async () => {
    const fixture = fixtureTransport([demoFiles[0]], sources);
    const calls: string[] = [];
    const transport: Transport = async (input, init) => {
      calls.push(input);
      const response = await fixture(input, init);
      response.headers.set(
        'x-ratelimit-remaining',
        input.includes('/files?') ? '1' : '2',
      );
      return response;
    };
    const review = await reviewPullRequest(PR_URL, new GitHubClient(transport));
    expect(review.snapshotVerified).toBe(true);
    expect(review.files[0].reason).toContain('reserved');
    expect(calls.some((url) => url.includes('/contents/'))).toBe(false);
  });
  it('reports exact uninventoried coverage on a failed file page', async () => {
    const fixture = fixtureTransport();
    const review = await reviewPullRequest(
      PR_URL,
      new GitHubClient((input, init) =>
        input.includes('/files?')
          ? Promise.resolve(json({}, 503))
          : fixture(input, init),
      ),
    );
    expect(review.coverage).toEqual({
      total: 8,
      inventoried: 0,
      analyzed: 0,
      skipped: 0,
      uninventoried: 8,
    });
    expect(review.findings).toEqual([]);
  });
  it('recognizes merged PR metadata', async () => {
    const client = new GitHubClient(async () =>
      json(apiPr({ merged: true, state: 'closed' })),
    );
    expect((await client.getPullRequest(pr)).state).toBe('merged');
  });
});
