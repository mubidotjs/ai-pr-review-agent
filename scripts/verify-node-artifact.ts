import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createIngestionPayloadFixture } from '../tests/ingestion-payload-fixture';
import {
  maximumFrameSnapshot,
  referenceFrame,
} from '../tests/node-stream-fixtures';
import { localNodeRoute } from '../tests/node-http';
import { serializeSnapshot } from '../src/server/review';
import { SNAPSHOT_MEDIA_TYPE } from '../src/server/node-adapter';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { PR_URL } from '../tests/upstream-fixtures';

// Native ESM import of the packaged Function artifact, not the TypeScript source.
const directory = '.vercel/output/functions/ingestion.func';
const config = JSON.parse(
  await readFile(`${directory}/.vc-config.json`, 'utf8'),
);
assert.equal(config.shouldAddHelpers, false);
assert.equal(config.supportsResponseStreaming, true);
assert.equal(config.runtime, 'nodejs24.x');
assert.equal(config.maxDuration, 40);
const { default: api } = (await import(
  pathToFileURL(resolve(directory, config.handler)).href
)) as {
  default: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};
const originalFetch = globalThis.fetch,
  originalNow = Date.now;
const previousOrigin = process.env.PRISM_PUBLIC_ORIGIN;
const fixture = createIngestionPayloadFixture();
let now = 1900000000000,
  requests = 0;
const server = createServer((req, res) => {
  if (req.headers['x-test-parsed-body']) Object.assign(req, { body: {} });
  void api(req, res);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = (base: string) =>
  originalFetch(`${base}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: PR_URL }),
  });
const hash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
try {
  delete process.env.PRISM_PUBLIC_ORIGIN;
  const disabled = await post(origin);
  assert.equal(disabled.status, 503);
  await disabled.arrayBuffer();
  process.env.PRISM_PUBLIC_ORIGIN = origin;
  const parsed = await originalFetch(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'X-Test-Parsed-Body': '1' },
  });
  assert.equal(parsed.status, 400);
  assert.match(await parsed.text(), /RAW_BODY_REQUIRED/);
  const health = await originalFetch(`${origin}/api/health`);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    ai: 'disabled',
    runtime: 'node',
  });
  Date.now = () => now;
  globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string');
    assert.ok(String(input).startsWith('https://api.github.com/'));
    requests++;
    now = 1900000000100;
    return fixture.transport(String(input), init!);
  };
  const started = performance.now(),
    response = await post(origin);
  assert.equal(response.status, 200);
  const legal = new Uint8Array(await response.arrayBuffer());
  assert.equal(legal.length, 4752446);
  const snapshot = decodeSnapshotWire(legal.buffer) as {
    files: { context?: unknown }[];
    budget: { requests: number };
    verification: { after: unknown };
  };
  assert.equal(snapshot.files.length, 100);
  assert.equal(snapshot.files.filter((f) => f.context).length, 6);
  assert.equal(snapshot.budget.requests, 11);
  assert.equal(requests, 11);
  assert.ok(snapshot.verification.after);
  const legalMs = performance.now() - started;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  const maximum = maximumFrameSnapshot(),
    oracle = referenceFrame(maximum);
  const route = await localNodeRoute(() => {
    const frame = serializeSnapshot(maximum);
    return new Response(frame.body, {
      headers: {
        'Content-Type': SNAPSHOT_MEDIA_TYPE,
        'Content-Length': String(frame.bytes),
      },
    });
  });
  try {
    const maxStarted = performance.now(),
      maxResponse = await post(route.origin);
    const bytes = new Uint8Array(await maxResponse.arrayBuffer());
    assert.equal(bytes.length, 12582912);
    assert.equal(hash(bytes), hash(oracle));
    decodeSnapshotWire(bytes.buffer);
    const evidence = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      method:
        'Loopback HTTP. Packaged Build Output API handler for bounded ingestion; same Node adapter with direct synthetic snapshot for the transport ceiling. No platform deployment, real GitHub requests or inference.',
      artifact: {
        runtime: config.runtime,
        streamingRequested: config.supportsResponseStreaming,
        helpers: config.shouldAddHelpers,
        maxDurationSeconds: config.maxDuration,
      },
      ingestion: {
        bytes: legal.length,
        sha256: hash(legal),
        elapsedMs: Math.round(legalMs),
        upstreamRequests: requests,
        inventoried: 100,
        contexts: 6,
        finalVerified: true,
        transferEncoding: response.headers.get('transfer-encoding'),
      },
      transportCeiling: {
        bytes: bytes.length,
        sha256: hash(bytes),
        independentOracleMatches: true,
        elapsedMs: Math.round(performance.now() - maxStarted),
        transferEncoding: maxResponse.headers.get('transfer-encoding'),
        acquisitionBudgetClaim: false,
      },
      checks: [
        'missing origin fails closed',
        'parsed body refused',
        'native ESM package loads',
        'AI disabled',
        'exact byte count',
        'decoder and EOF',
        'independent 12-MiB hash',
      ],
      platformCompatibility:
        'NOT VERIFIED: local Node HTTP does not exercise Vercel launcher, routing or front proxy.',
    };
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/milestone-4-node-streaming.json',
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await route.close();
  }
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (previousOrigin === undefined) delete process.env.PRISM_PUBLIC_ORIGIN;
  else process.env.PRISM_PUBLIC_ORIGIN = previousOrigin;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
