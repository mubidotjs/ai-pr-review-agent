import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
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
import { fixtureTransport } from '../tests/upstream-fixtures';
import { oneFindingModel } from '../tests/agent-fixtures';
import type { ModelRequest } from '../src/server/agent/protocol';

// Native ESM import of the packaged Function artifact, not the TypeScript source.
const directory = '.vercel/output/functions/ingestion.func';
assert.deepEqual(
  (await readdir('.vercel/output/functions')).sort(),
  ['agent.func', 'ingestion.func'],
  'Production artifact must exclude operator fixtures/routes',
);
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
const { default: agentApi } = (await import(
  pathToFileURL(resolve('.vercel/output/functions/agent.func/agent.mjs')).href
)) as { default: typeof api };
const originalFetch = globalThis.fetch,
  originalNow = Date.now;
const previousOrigin = process.env.PRISM_PUBLIC_ORIGIN;
const envKeys = [
  'PRISM_ACCESS_CODE',
  'PRISM_SESSION_SECRET',
  'PRISM_AI_ORIGIN',
  'PRISM_RELAY_SECRET',
] as const;
const previousRelease = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
let cookie = '';
const fixture = createIngestionPayloadFixture();
let now = 1900000000000,
  requests = 0;
let agentPhase = false;
const script = oneFindingModel(),
  agentTransport = fixtureTransport();
const drafts = new Map<string, unknown>();
const server = createServer((req, res) => {
  if (req.headers['x-test-parsed-body']) Object.assign(req, { body: {} });
  void (req.url?.startsWith('/api/agent') ? agentApi : api)(req, res);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = (base: string) =>
  originalFetch(`${base}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
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
  process.env.PRISM_ACCESS_CODE = 'b'.repeat(64);
  process.env.PRISM_SESSION_SECRET = 'c'.repeat(64);
  process.env.PRISM_AI_ORIGIN = 'https://prism-test.example.workers.dev';
  process.env.PRISM_RELAY_SECRET = 'a'.repeat(64);
  Date.now = () => now;
  globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string');
    if (String(input).startsWith(process.env.PRISM_AI_ORIGIN!)) {
      const body = JSON.parse(String(init?.body));
      if (String(input).endsWith('/admit'))
        return Response.json({ grant: '00000000-0000-4000-8000-000000000000' });
      if (String(input).endsWith('/decide'))
        return Response.json({
          decision: JSON.parse(
            await script.next(body.request as ModelRequest, init!.signal!),
          ),
          bindingResponse: true,
        });
      if (String(input).endsWith('/draft')) drafts.set(body.runId, body.result);
      if (String(input).endsWith('/approve'))
        return Response.json({ result: drafts.get(body.runId) });
      return Response.json({ ok: true });
    }
    assert.ok(String(input).startsWith('https://api.github.com/'));
    requests++;
    now = 1900000000100;
    return agentPhase
      ? agentTransport(String(input), init!)
      : fixture.transport(String(input), init!);
  };
  const parsed = await originalFetch(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'X-Test-Parsed-Body': '1' },
  });
  assert.equal(parsed.status, 400);
  assert.match(await parsed.text(), /RAW_BODY_REQUIRED/);
  const health = await originalFetch(`${origin}/api/health`);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    ai: 'access-controlled',
    runtime: 'node',
  });
  assert.equal((await post(origin)).status, 401);
  const login = await originalFetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: process.env.PRISM_ACCESS_CODE }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie')!.split(';')[0];
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
  const ingestionRequests = requests;
  agentPhase = true;
  const agentResponse = await originalFetch(`${origin}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ url: PR_URL }),
  });
  assert.equal(agentResponse.status, 200);
  const agentDraft = await agentResponse.json();
  assert.equal(agentDraft.result.findings.length, 1);
  assert.equal(agentDraft.result.findings[0].line, 2);
  assert.equal(agentDraft.result.budget.githubRequests, 9);
  const approval = await originalFetch(`${origin}/api/agent/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      actor: 'human',
      confirm: true,
      runId: agentDraft.result.runId,
      digest: agentDraft.digest,
      selectedIndexes: [0],
    }),
  });
  assert.equal(approval.status, 200);
  assert.equal((await approval.json()).publicationPerformed, false);
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
        upstreamRequests: ingestionRequests,
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
        'packaged agent Function mock-backed evidence and human approval',
        'missing origin fails closed',
        'parsed body refused',
        'native ESM package loads',
        'authenticated release ingestion makes no AI calls',
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
  for (const key of envKeys) {
    if (previousRelease[key] === undefined) delete process.env[key];
    else process.env[key] = previousRelease[key];
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
