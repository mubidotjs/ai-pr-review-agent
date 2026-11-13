import { request as httpRequest } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/index';
import {
  nodePublicOrigin,
  SNAPSHOT_MEDIA_TYPE,
} from '../src/server/node-adapter';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { analyzeSnapshot } from '../src/analysis/review';
import { LIMITS } from '../src/shared/types';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { localNodeRoute } from './node-http';

const post = (origin: string, init: RequestInit = {}) =>
  fetch(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: PR_URL }),
    ...init,
  });
const binary = (
  body: ReadableStream<Uint8Array> | Uint8Array,
  length?: number,
) =>
  new Response(body as BodyInit, {
    headers: {
      'Content-Type': SNAPSHOT_MEDIA_TYPE,
      ...(length === undefined ? {} : { 'Content-Length': String(length) }),
    },
  });

describe('Node boundary failures through real HTTP', () => {
  it('bounds an unfinished request body without dispatching GitHub requests', async () => {
    const upstream = vi.fn(fixtureTransport()),
      app = createApp(upstream),
      route = await localNodeRoute((r) => app.fetch(r), { deadlineMs: 120 });
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          `${route.origin}/api/review`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => {
              resolve(res.statusCode!);
              req.destroy();
            });
          },
        );
        req.on('error', reject);
        req.write('{"url":'); // Deliberately never send EOF.
      });
      expect(status).toBe(504);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      await route.close();
    }
  });

  it('holds instance admission through response delivery, then releases it on EOF', async () => {
    let release!: () => void,
      streaming = true,
      pulls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = await localNodeRoute(() =>
      streaming
        ? binary(
            new ReadableStream(
              {
                async pull(c) {
                  if (pulls++ === 0) c.enqueue(new Uint8Array([0, 0, 0, 2]));
                  else {
                    await gate;
                    c.enqueue(new Uint8Array([123, 125]));
                    c.close();
                  }
                },
              },
              { highWaterMark: 0 },
            ),
          )
        : Response.json({ complete: true }),
    );
    try {
      const first = await post(route.origin);
      const busy = await post(route.origin);
      expect(busy.status).toBe(429);
      expect(await busy.text()).toContain('BUSY');
      streaming = false;
      release();
      await first.arrayBuffer();
      const next = await post(route.origin);
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ complete: true });
    } finally {
      release();
      await route.close();
    }
  });

  it('fails closed for unsafe or noncanonical configured origins', () => {
    for (const value of [
      'http://example.com',
      'https://example.com/',
      'https://u:p@example.com',
      'https://example.com?q=1',
      'https://example.com/#x',
    ])
      expect(() => nodePublicOrigin(value)).toThrow();
    expect(nodePublicOrigin('https://example.com')).toBe('https://example.com');
  });

  it('enforces Host, same-origin and raw byte limits without using forwarding headers', async () => {
    const upstream = vi.fn(fixtureTransport()),
      app = createApp(upstream),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          `${route.origin}/api/review`,
          { method: 'POST', headers: { Host: 'evil.example' } },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(wrongHost).toBe(400);
      const cross = await post(route.origin, {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
          'X-Forwarded-Host': 'evil.example',
        },
      });
      expect(cross.status).toBe(403);
      expect(cross.headers.get('access-control-allow-origin')).toBeNull();
      const oversized = await post(route.origin, { body: 'x'.repeat(2049) });
      expect(oversized.status).toBe(413);
      const invalidUrl = await post(route.origin, {
        body: JSON.stringify({
          url: 'https://github.com.evil.example/a/b/pull/1',
        }),
      });
      expect(invalidUrl.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      const valid = await post(route.origin, {
        headers: {
          'Content-Type': 'application/json',
          Origin: route.origin,
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect(valid.status).toBe(200);
      await valid.arrayBuffer();
    } finally {
      await route.close();
    }
  });

  it('rejects chunked oversized input before any upstream request', async () => {
    const upstream = vi.fn(fixtureTransport()),
      app = createApp(upstream),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          `${route.origin}/api/review`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on('error', reject);
        req.write('x'.repeat(1024));
        req.end('x'.repeat(1025));
      });
      expect(status).toBe(413);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      await route.close();
    }
  });

  it('preserves exhausted shared-IP quota headers and instance cooldown without retries', async () => {
    const upstream = vi.fn(
      async () =>
        new Response('{}', {
          status: 403,
          headers: {
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Used': '60',
            'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + 3600),
            'Retry-After': '120',
          },
        }),
    );
    const app = createApp(upstream),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const first = await post(route.origin),
        error = await first.json();
      expect(first.status).toBe(429);
      expect(error.error.rateLimit).toMatchObject({
        limit: 60,
        remaining: 0,
        used: 60,
      });
      expect(error.error.retryAt).toBeGreaterThan(Date.now() / 1000);
      expect((await post(route.origin)).status).toBe(429);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      await route.close();
    }
  });

  it('suppresses evidence and findings if final snapshot verification fails', async () => {
    const delegate = fixtureTransport();
    let metadataReads = 0;
    const app = createApp((url, init) => {
        if (url.endsWith('/pulls/42') && ++metadataReads === 2)
          return Promise.resolve(new Response('{}', { status: 503 }));
        return delegate(url, init);
      }),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const result = analyzeSnapshot(
        decodeSnapshotWire(await (await post(route.origin)).arrayBuffer()),
      );
      expect(result.review.findings).toEqual([]);
      expect(result.review.coverage.analyzed).toBe(0);
      expect(result.review.coverage.skipped).toBe(
        result.review.coverage.inventoried,
      );
    } finally {
      await route.close();
    }
  });

  it('times out before headers, aborts upstream, and releases admission for recovery', async () => {
    let aborted = false,
      calls = 0;
    const app = createApp((_url, init) => {
        calls++;
        return new Promise((_resolve, reject) =>
          init.signal!.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('PRIVATE_PROVIDER_DETAIL'));
            },
            { once: true },
          ),
        );
      }),
      route = await localNodeRoute((r) => app.fetch(r), { deadlineMs: 120 });
    try {
      const first = await post(route.origin),
        text = await first.text();
      expect(first.status).toBe(504);
      expect(text).toContain('TIME_LIMIT');
      expect(text).not.toContain('PRIVATE');
      await vi.waitFor(() => expect(aborted).toBe(true));
      expect(calls).toBe(1);
      const next = await post(route.origin, { body: '{}' });
      expect(next.status).toBe(400);
    } finally {
      await route.close();
    }
  });

  it('propagates client disconnect during ingestion, without another upstream call', async () => {
    let aborted = false;
    const upstream = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('private'));
            },
            { once: true },
          );
        }),
    );
    const app = createApp(upstream),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const controller = new AbortController(),
        pending = post(route.origin, { signal: controller.signal }).catch(
          () => undefined,
        );
      await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
      controller.abort();
      await pending;
      await vi.waitFor(() => expect(aborted).toBe(true));
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      await route.close();
    }
  });

  it('safe errors never reveal unexpected exception text', async () => {
    const route = await localNodeRoute(() => {
      throw new Error('SECRET_REPO_TEXT');
    });
    try {
      const res = await post(route.origin);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain('SECRET_REPO_TEXT');
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      await route.close();
    }
  });

  it.each([
    ['invalid JSON', new Uint8Array([0, 0, 0, 1, 123])],
    ['truncated metadata', new Uint8Array([0, 0, 0, 9, 123])],
    ['trailing bytes', new Uint8Array([0, 0, 0, 2, 123, 125, 0])],
    ['invalid UTF-8', new Uint8Array([0, 0, 0, 1, 255])],
  ])(
    'leaves the unchanged decoder rejecting %s after HTTP transport',
    async (_name, bytes) => {
      const route = await localNodeRoute(() => binary(bytes));
      try {
        const data = await (await post(route.origin)).arrayBuffer();
        expect(() => decodeSnapshotWire(data)).toThrow();
      } finally {
        await route.close();
      }
    },
  );

  it('rejects an over-limit declared response before delivering binary data', async () => {
    let cancelled = false;
    const route = await localNodeRoute(() =>
      binary(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        LIMITS.snapshotBytes + 1,
      ),
    );
    try {
      const response = await post(route.origin);
      expect(response.status).toBe(413);
      expect(await response.text()).toContain('SNAPSHOT_BYTE_LIMIT');
      expect(cancelled).toBe(true);
    } finally {
      await route.close();
    }
  });

  it.each([
    'source error',
    'short declared length',
    'too many bytes',
    'transfer timeout',
  ])(
    'terminates %s without successful EOF or appended error text',
    async (mode) => {
      let count = 0,
        cancelled = false;
      const route = await localNodeRoute(
        () =>
          binary(
            new ReadableStream(
              {
                async pull(c) {
                  if (count++ === 0) {
                    c.enqueue(new Uint8Array([0, 0, 0, 2]));
                    return;
                  }
                  await pause(30);
                  if (cancelled) return;
                  if (mode === 'source error')
                    c.error(new Error('SECRET_UNTRUSTED_EXCEPTION'));
                  else if (mode === 'short declared length') c.close();
                  else if (mode === 'too many bytes')
                    c.enqueue(new Uint8Array(LIMITS.snapshotBytes));
                  // Timeout path deliberately stalls after the initial prefix.
                },
                cancel() {
                  cancelled = true;
                },
              },
              { highWaterMark: 0 },
            ),
            mode === 'short declared length' ? 100 : undefined,
          ),
        { deadlineMs: mode === 'transfer timeout' ? 120 : 2000 },
      );
      try {
        const response = await post(route.origin),
          reader = response.body!.getReader();
        expect(Array.from((await reader.read()).value!)).toEqual([0, 0, 0, 2]);
        await expect(reader.read()).rejects.toThrow();
        if (mode === 'too many bytes' || mode === 'transfer timeout')
          await vi.waitFor(() => expect(cancelled).toBe(true));
      } finally {
        await route.close();
      }
    },
  );
});
