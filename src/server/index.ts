import { Hono } from 'hono';
import { LIMITS } from '../shared/types';
import { GitHubClient, type Transport } from './github';
import { reviewPullRequest } from './review';
import { boundedText, ReviewError } from './security';

export function createApp(transport?: Transport) {
  const app = new Hono();
  // Ephemeral rate cooldown only. No repository content or identifiers are retained.
  let cooldownUntil = 0;
  let activeReviews = 0;
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json(
        {
          error: {
            code: 'ORIGIN_REJECTED',
            message: 'Same-origin requests only.',
          },
        },
        403,
      );
    await next();
  });
  app.get('/api/health', (c) =>
    c.json({ status: 'ok', ai: 'disabled', runtime: 'local-worker' }),
  );
  app.post('/api/review', async (c) => {
    if (Date.now() < cooldownUntil)
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'GitHub cooldown active. Retry manually after the reset.',
            retryAt: Math.ceil(cooldownUntil / 1000),
          },
        },
        429,
      );
    if (activeReviews >= 1)
      return c.json(
        {
          error: {
            code: 'BUSY',
            message:
              'One local review is already running. Wait for completion or cancellation.',
          },
        },
        429,
      );
    let client: GitHubClient | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, LIMITS.durationMs);
    activeReviews++;
    try {
      if (c.req.raw.signal.aborted) controller.abort();
      if (
        !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')
      )
        throw new ReviewError(
          'CONTENT_TYPE',
          'Send an application/json request.',
          415,
        );
      const text = await boundedText(
        new Response(c.req.raw.body),
        LIMITS.bodyBytes,
        undefined,
        controller.signal,
      );
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ReviewError(
          'INVALID_JSON',
          'Request body must be valid JSON.',
        );
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('url' in body) ||
        typeof body.url !== 'string' ||
        Object.keys(body).length !== 1
      )
        throw new ReviewError(
          'INVALID_BODY',
          'Provide only a string url field.',
        );
      client = new GitHubClient(transport, controller.signal);
      return c.json(await reviewPullRequest(body.url, client));
    } catch (error) {
      const known =
        error instanceof ReviewError
          ? error
          : new ReviewError(
              'INTERNAL_ERROR',
              'Review failed safely. No speculative findings returned.',
              500,
            );
      return c.json(
        {
          error: {
            code: known.code,
            message: known.message,
            rateLimit: client?.rateLimit,
            retryAt: client?.rateLimit.retryAt ?? client?.rateLimit.resetAt,
          },
        },
        known.status as 400,
      );
    } finally {
      if (client?.rateLimit.remaining === 0 || client?.rateLimit.retryAt)
        cooldownUntil = Math.max(
          cooldownUntil,
          (client.rateLimit.retryAt ??
            client.rateLimit.resetAt ??
            Math.ceil(Date.now() / 1000) + 60) * 1000,
        );
      clearTimeout(timer);
      c.req.raw.signal.removeEventListener('abort', abort);
      activeReviews--;
    }
  });
  app.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } },
      404,
    ),
  );
  return app;
}
export default createApp();
