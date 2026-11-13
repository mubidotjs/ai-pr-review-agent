import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/index';
import { fixtureTransport, json, PR_URL } from './fixtures';

describe('same-origin local review API', () => {
  it('returns deterministic data with no-store and no CORS headers', async () => {
    const app = createApp(fixtureTransport());
    const response = await app.request('/api/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
      },
      body: JSON.stringify({ url: PR_URL }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const review = await response.json();
    expect(review.findings).toHaveLength(3);
    expect(review.ai.status).toBe('disabled');
  });
  it('rejects cross-origin requests before any GitHub request', async () => {
    const transport = vi.fn(fixtureTransport());
    const response = await createApp(transport).request('/api/review', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: PR_URL }),
    });
    expect(response.status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    [{ url: PR_URL, token: 'not-allowed' }, 400],
    [{ url: 42 }, 400],
    [{}, 400],
    [null, 400],
    [{ url: 'https://localhost/pull/1' }, 400],
  ])('rejects invalid bodies %s', async (body, status) => {
    const response = await createApp(fixtureTransport()).request(
      '/api/review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    expect(response.status).toBe(status);
  });
  it('rejects malformed JSON, excessive bytes, and wrong content type', async () => {
    const app = createApp(fixtureTransport());
    expect(
      (
        await app.request('/api/review', {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await app.request('/api/review', {
          method: 'POST',
          body: '{',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/review', {
          method: 'POST',
          body: JSON.stringify({ url: 'x'.repeat(2100) }),
          headers: { 'Content-Type': 'application/json' },
        })
      ).status,
    ).toBe(413);
  });
  it('keeps only ephemeral cooldown metadata and avoids repeat upstream calls', async () => {
    const transport = vi.fn(async () =>
      json({ message: 'rate limit' }, 429, { 'Retry-After': '60' }),
    );
    const app = createApp(transport);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PR_URL }),
    };
    expect((await app.request('/api/review', options)).status).toBe(429);
    expect((await app.request('/api/review', options)).status).toBe(429);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('exposes no tool or write endpoints', async () => {
    const app = createApp(fixtureTransport());
    expect((await app.request('/api/readFileContext')).status).toBe(404);
    expect((await app.request('/api/review', { method: 'PUT' })).status).toBe(
      404,
    );
    expect(await (await app.request('/api/health')).json()).toMatchObject({
      ai: 'disabled',
    });
  });
});
