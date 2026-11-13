import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  default as deployedProbe,
  createTransportHandler,
  PROBE_PATH,
} from '../scripts/vercel-transport/harness';

it.each(['omitted', 'chunked'] as const)(
  'checks body bytes when proxy framing is %s, before starting a fixture',
  async (framing) => {
    const events: { event: string }[] = [];
    const secret = 'a'.repeat(64);
    const server = createServer((req, res) => {
      // Simulate normalization after the HTTP parser has framed the real bytes.
      delete req.headers['content-length'];
      if (framing === 'chunked') req.headers['transfer-encoding'] = 'chunked';
      void handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const handler = createTransportHandler({
      origin,
      secret,
      expiresAt: Date.now() + 60000,
      directory: '.',
      event: (event) => events.push(event),
    });
    const post = (body: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          origin + PROBE_PATH,
          {
            method: 'POST',
            headers: {
              'Content-Length': Buffer.byteLength(body),
              'X-Prism-Probe': secret,
              'X-Prism-Case': 'abort',
            },
          },
          (res) => {
            if (res.statusCode === 200) {
              resolve(200);
              res.destroy();
            } else {
              res.resume();
              res.on('end', () => resolve(res.statusCode!));
            }
          },
        );
        req.on('error', reject);
        req.end(body);
      });
    try {
      expect(await post('x')).toBe(400);
      expect(events).toEqual([]);
      expect(await post('')).toBe(200);
      await vi.waitFor(() =>
        expect(events.some((event) => event.event === 'cancelled')).toBe(true),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('keeps the isolated harness authenticated, expiring, bodyless and without real ingestion or outbound fetch', async () => {
  const events: unknown[] = [],
    secret = 'a'.repeat(64);
  let handler: ReturnType<typeof createTransportHandler>;
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const options = {
    origin,
    secret,
    expiresAt: Date.now() + 60000,
    directory: '.',
    event: (event: unknown) => {
      events.push(event);
    },
  };
  handler = createTransportHandler(options);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Outbound forbidden'));
  const post = (
    path = PROBE_PATH,
    headers: Record<string, string> = {},
    body = '',
  ) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + path,
        {
          method: 'POST',
          headers: { 'Content-Length': Buffer.byteLength(body), ...headers },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  try {
    expect(await post()).toBe(401);
    expect(await post(PROBE_PATH, { 'X-Prism-Probe': 'b'.repeat(64) })).toBe(
      401,
    );
    expect(await post(PROBE_PATH, { 'X-Prism-Probe': 'é'.repeat(64) })).toBe(
      401,
    );
    expect(await post('/api/review', { 'X-Prism-Probe': secret })).toBe(404);
    expect(
      await post(PROBE_PATH, {
        'X-Prism-Probe': secret,
        'X-Prism-Case': 'arbitrary-file',
      }),
    ).toBe(400);
    expect(
      await post(
        PROBE_PATH,
        { 'X-Prism-Probe': secret, 'X-Prism-Case': 'delayed' },
        'x',
      ),
    ).toBe(400);
    handler = createTransportHandler({ ...options, expiresAt: Date.now() - 1 });
    expect(
      await post(PROBE_PATH, {
        'X-Prism-Probe': secret,
        'X-Prism-Case': 'maximum',
      }),
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  } finally {
    fetch.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects missing credentials or invalid expiry configuration', () => {
  expect(() =>
    createTransportHandler({
      origin: 'https://example.com',
      secret: '',
      expiresAt: 0,
      directory: '.',
    }),
  ).toThrow();
  expect(() =>
    createTransportHandler({
      origin: 'https://example.com',
      secret: 'a'.repeat(64),
      expiresAt: NaN,
      directory: '.',
    }),
  ).toThrow();
});

it('fails closed with a fixed configuration category if the deployed target lacks its secret', async () => {
  vi.stubEnv('PRISM_TRANSPORT_SECRET', '');
  const server = createServer((req, res) => {
    void deployedProbe(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await new Promise<{
      status: number;
      category: string | string[] | undefined;
      bytes: number;
    }>((resolve) => {
      const req = httpRequest(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${PROBE_PATH}`,
        { method: 'POST', headers: { 'Content-Length': '0' } },
        (res) => {
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              category: res.headers['x-prism-probe-error'],
              bytes,
            }),
          );
        },
      );
      req.end();
    });
    expect(response).toEqual({
      status: 503,
      category: 'SECRET_NOT_CONFIGURED',
      bytes: 0,
    });
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
