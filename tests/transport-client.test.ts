import { createHash } from 'node:crypto';
import { createServer, get } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  probe,
  probeCommand,
  type ProbeOptions,
} from '../scripts/vercel-transport/client';
import {
  createTransportHandler,
  type SafeEvent,
} from '../scripts/vercel-transport/harness';
import { maximumFrameSnapshot, referenceFrame } from './node-stream-fixtures';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { LIMITS } from '../src/shared/types';

const secret = 'a'.repeat(64);
let directory: string, frame: Buffer;
const expected = {
  bytes: 12582912,
  sha256: '3438b890c3b885defdebebde8dcd7c73736bffb20961571c257f9e3eba7d2409',
};
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'prism-client-'));
  frame = referenceFrame(maximumFrameSnapshot());
  expect(frame.length).toBe(expected.bytes);
  expect(createHash('sha256').update(frame).digest('hex')).toBe(
    expected.sha256,
  );
  await writeFile(join(directory, 'maximum.bin'), frame);
});
afterAll(async () => {
  const parent = resolve(tmpdir()),
    target = resolve(directory);
  if (
    !relative(parent, target).startsWith('prism-client-') ||
    relative(parent, target).includes('..')
  )
    throw new Error('Unsafe temporary fixture cleanup');
  await rm(target, { recursive: true, force: true });
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function harness() {
  const events: SafeEvent[] = [];
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  const url = await listen(server);
  const handler = createTransportHandler({
    origin: url,
    secret,
    expiresAt: Date.now() + 180000,
    directory,
    event: (e) => events.push(e),
  });
  return { server, url, events };
}
const local = (
  url: string,
  extra: Partial<ProbeOptions> = {},
): ProbeOptions => ({
  url,
  scenario: 'maximum',
  expected,
  secret,
  transport: { kind: 'loopback' },
  ...extra,
});

it('passes the precise Vercel command via process cwd and stdin with a separate 120s transfer cap', () => {
  const options: ProbeOptions = {
    url: 'https://example.vercel.app',
    scenario: 'maximum',
    secret,
    transport: {
      kind: 'vercel',
      cli: 'official-vc.js',
      scope: 'owner',
      cwd: 'acceptance',
    },
  };
  const command = probeCommand(options);
  expect(command.args).toEqual([
    'official-vc.js',
    'curl',
    '/api/transport-probe',
    '--deployment',
    options.url,
    '--scope',
    'owner',
    '--',
    '--config',
    '-',
  ]);
  expect(command.args.join(' ')).not.toContain(secret);
  expect(command.args).not.toContain('--cwd');
  expect(command.cwd).toBe('acceptance');
  expect(command.config).toContain('max-time = 120\nretry = 0');
  expect(command.config).toContain('Accept-Encoding: identity');
  expect(command.watchdogMs).toBe(145000);
  expect(LIMITS.durationMs).toBe(30000);
  expect(probeCommand({ ...options, scenario: 'error' }).transferSeconds).toBe(
    35,
  );
  expect(probeCommand({ ...options, scenario: 'abort' }).transferSeconds).toBe(
    3,
  );
  expect(() => probeCommand({ ...options, transferSeconds: 121 })).toThrow();
  expect(() => probeCommand({ ...options, transferSeconds: NaN })).toThrow();
});

it('verifies the exact maximum frame through the real protected local harness with the shared curl client', async () => {
  const h = await harness();
  try {
    const result = await probe(local(h.url));
    expect(result).toMatchObject({
      pass: true,
      classification: 'PASS',
      bytes: expected.bytes,
      sha256: expected.sha256,
      exactIntegrity: true,
      eof: true,
      transferTimeoutSeconds: 120,
    });
    expect(result.headers['x-prism-deadline-ms']).toBe('30000');
    expect(
      h.events.some(
        (e) => e.event === 'complete' && e.bytes === expected.bytes,
      ),
    ).toBe(true);
  } finally {
    await close(h.server);
  }
});

it('permits downstream transfer beyond 35s after the unchanged 30s Node source completed', async () => {
  const h = await harness();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Fixed loopback downstream emulator. It buffers only this synthetic fixture,
  // never public PR input, and has no arbitrary target/proxy capability.
  const downstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    const upstream = get(
      h.url + '/api/transport-probe',
      {
        method: 'POST',
        headers: {
          'X-Prism-Probe': secret,
          'X-Prism-Case': 'maximum',
          'Content-Length': '0',
        },
      },
      (input) => {
        input.on('data', (chunk) => chunks.push(chunk));
        input.on('end', () => {
          const bytes = Buffer.concat(chunks);
          expect(bytes.length).toBe(expected.bytes);
          res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': bytes.length,
            'X-Prism-Snapshot-Bytes': bytes.length,
          });
          res.write(bytes.subarray(0, 4));
          timer = setTimeout(() => res.end(bytes.subarray(4)), 36000);
        });
      },
    );
    req.on('aborted', () => upstream.destroy());
  });
  const url = await listen(downstream);
  try {
    const result = await probe(local(url));
    expect(result).toMatchObject({
      pass: true,
      exactIntegrity: true,
      eof: true,
      transferTimeoutSeconds: 120,
    });
    expect(result.elapsedMs).toBeGreaterThan(35000);
    expect(
      h.events.find((e) => e.event === 'complete')!.elapsedMs,
    ).toBeLessThan(30000);
    console.log(
      JSON.stringify({
        localSyntheticDownstream: result,
        sourceComplete: h.events.find((e) => e.event === 'complete'),
      }),
    );
  } finally {
    clearTimeout(timer);
    await close(downstream);
    await close(h.server);
  }
}, 45000);

it('classifies the actual curl timeout without inferring platform termination', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': expected.bytes,
    });
    res.write(frame.subarray(0, 4));
  });
  const url = await listen(server);
  try {
    const result = await probe(local(url, { transferSeconds: 0.15 }));
    expect(result).toMatchObject({
      pass: false,
      classification: 'CLIENT_TIMEOUT',
      exitCode: 28,
      eof: false,
    });
    expect(result.elapsedMs).toBeLessThan(5000);
  } finally {
    await close(server);
  }
});

it('rejects a complete response with the wrong SHA-256 and distinguishes recognized platform errors', async () => {
  let platform = false;
  const server = createServer((_req, res) => {
    if (platform) {
      res.writeHead(504, { 'x-vercel-error': 'FUNCTION_INVOCATION_TIMEOUT' });
      res.end();
    } else {
      res.writeHead(200, { 'Cache-Control': 'no-store' });
      res.end(Buffer.alloc(expected.bytes));
    }
  });
  const url = await listen(server);
  try {
    expect(await probe(local(url))).toMatchObject({
      pass: false,
      classification: 'RESPONSE_CORRUPTION',
      eof: true,
    });
    platform = true;
    expect(await probe(local(url))).toMatchObject({
      pass: false,
      classification: 'PLATFORM_TERMINATION',
      status: 504,
    });
  } finally {
    await close(server);
  }
});

it('recognizes controlled incomplete framing, then verifies real cancellation and bounded cleanup', async () => {
  const h = await harness();
  try {
    const failed = await probe(
      local(h.url, { scenario: 'error', expected: undefined }),
    );
    expect(failed).toMatchObject({
      pass: true,
      classification: 'EXPECTED_INCOMPLETE_FRAME',
      bytes: 4,
    });
    expect(() =>
      decodeSnapshotWire(new Uint8Array([0, 0, 4, 0]).buffer),
    ).toThrow();
    const aborted = await probe(
      local(h.url, { scenario: 'abort', expected: undefined }),
    );
    expect(aborted).toMatchObject({
      pass: true,
      classification: 'EXPECTED_CLIENT_ABORT',
      exitCode: 28,
      eof: false,
    });
    await vi.waitFor(() =>
      expect(
        h.events.some(
          (e) =>
            e.case === 'abort' &&
            e.event === 'cancelled' &&
            e.elapsedMs < 30000,
        ),
      ).toBe(true),
    );
    expect(
      h.events.some(
        (e) => e.case === 'error' && e.event === 'controlled-error',
      ),
    ).toBe(true);
  } finally {
    await close(h.server);
  }
});
