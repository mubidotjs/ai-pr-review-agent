import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { GitHubClient } from '../../src/server/github';
import { ingestPullRequest, serializeSnapshot } from '../../src/server/review';
import { LIMITS } from '../../src/shared/types';
import { createIngestionPayloadFixture } from '../../tests/ingestion-payload-fixture';
import {
  maximumFrameSnapshot,
  referenceFrame,
} from '../../tests/node-stream-fixtures';
import { PR_URL } from '../../tests/upstream-fixtures';

const root = resolve('artifacts/m45-vercel'),
  output = `${root}/.vercel/output`,
  fn = `${output}/functions/api/transport-probe.func`;
await mkdir(fn, { recursive: true });
const fixture = createIngestionPayloadFixture(),
  client = new GitHubClient(fixture.transport);
const snapshot = await ingestPullRequest(PR_URL, client);
snapshot.id = '00000000-0000-4000-8000-000000000000';
snapshot.budget.durationMs = 100;
const frame = serializeSnapshot(snapshot),
  ingestion = Buffer.from(await new Response(frame.body).arrayBuffer());
assert.equal(ingestion.length, 4752446);
assert.equal(client.requests, 11);
assert.ok(snapshot.verification.after);
assert.ok(ingestion.equals(referenceFrame(snapshot)));
const maximum = referenceFrame(maximumFrameSnapshot());
assert.equal(maximum.length, LIMITS.snapshotBytes);
await build({
  configFile: false,
  build: {
    ssr: 'scripts/vercel-transport/harness.ts',
    outDir: fn,
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
  ssr: { noExternal: true },
});
for (const name of await readdir(fn)) {
  if (!name.endsWith('.map')) continue;
  const map = JSON.parse(await readFile(`${fn}/${name}`, 'utf8')) as {
    sources: string[];
  };
  assert.ok(
    map.sources.every(
      (p) =>
        !/(@babel|src\/analysis|server\/(github|review|index|agent)|client\/)/.test(
          p.replaceAll('\\', '/'),
        ),
    ),
    'Only transport may be deployed',
  );
}
await writeFile(`${fn}/ingestion.bin`, ingestion);
await writeFile(`${fn}/maximum.bin`, maximum);
const config = {
  runtime: 'nodejs24.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  supportsCancellation: true,
  maxDuration: 40,
};
await writeFile(`${fn}/.vc-config.json`, JSON.stringify(config, null, 2));
await writeFile(
  `${output}/config.json`,
  JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }] }, null, 2),
);
await writeFile(
  `${root}/vercel.json`,
  JSON.stringify(
    {
      framework: null,
      fluid: true,
      functions: {
        'api/transport-probe': { supportsCancellation: true, maxDuration: 40 },
      },
    },
    null,
    2,
  ),
);
await writeFile(
  `${root}/package.json`,
  JSON.stringify(
    { private: true, type: 'module', engines: { node: '24.x' } },
    null,
    2,
  ),
);
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const manifest = {
  baseline: '304057dbff901fb7f42a6e531b2a781d32cce65a',
  config,
  applicationDeadlineMs: LIMITS.durationMs,
  adapterSha256: digest(await readFile('src/server/node-adapter.ts')),
  cases: {
    ingestion: {
      bytes: ingestion.length,
      sha256: digest(ingestion),
      upstreamRequestsInBuildOnly: client.requests,
    },
    maximum: {
      bytes: maximum.length,
      sha256: digest(maximum),
      transportOnly: true,
    },
  },
  exclusions: [
    'real ingestion route',
    'GitHub transport',
    'Babel',
    'browser frontend',
    'AI',
    'persistent storage',
  ],
};
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(JSON.stringify(manifest, null, 2));
