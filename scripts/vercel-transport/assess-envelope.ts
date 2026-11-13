import { writeFile } from 'node:fs/promises';
import { ingestionEnvelopeBound } from './envelope';
import { GitHubClient } from '../../src/server/github';
import { ingestPullRequest } from '../../src/server/review';
import { validateSnapshot } from '../../src/analysis/snapshot';
import { LIMITS } from '../../src/shared/types';
import { createIngestionPayloadFixture } from '../../tests/ingestion-payload-fixture';
import {
  maximumFrameSnapshot,
  referenceFrame,
} from '../../tests/node-stream-fixtures';
import {
  apiFile,
  fixtureTransport,
  PR_URL,
} from '../../tests/upstream-fixtures';

const example = createIngestionPayloadFixture();
const client = new GitHubClient(example.transport);
const snapshot = validateSnapshot(await ingestPullRequest(PR_URL, client));
snapshot.id = '00000000-0000-4000-8000-000000000000';
snapshot.budget.durationMs = 100;
const adversarial = createIngestionPayloadFixture();
adversarial.metadata.title = '\u0000'.repeat(16384);
adversarial.metadata.body = '\u0000'.repeat(262144);
const escapedClient = new GitHubClient(
  fixtureTransport(
    adversarial.files,
    adversarial.contexts,
    adversarial.metadata,
  ),
);
const escaped = validateSnapshot(
  await ingestPullRequest(PR_URL, escapedClient),
);
escaped.id = snapshot.id;
escaped.budget.durationMs = 100;
const stress = maximumFrameSnapshot();
const result = {
  method:
    'Offline bounds and constructed fixtures through unchanged ingestion; no network or inference.',
  bound: ingestionEnvelopeBound(),
  validExample: {
    bytes: referenceFrame(snapshot).length,
    requests: client.requests,
    upstreamBytes: client.bytes,
    inventoried: snapshot.files.length,
    contexts: snapshot.budget.contextFiles,
    verified: !!snapshot.verification.after,
  },
  escapedMetadataExample: {
    bytes: referenceFrame(escaped).length,
    requests: escapedClient.requests,
    upstreamBytes: escapedClient.bytes,
    verified: !!escaped.verification.after,
  },
  stress: {
    bytes: referenceFrame(stress).length,
    bypassesAcquisition: true,
    hypotheticalFilePageBytes: [
      stress.files.slice(0, 50),
      stress.files.slice(50),
    ].map((files) => Buffer.byteLength(JSON.stringify(files.map(apiFile)))),
    perPageLimit: LIMITS.responseBytes,
    aggregateUpstreamLimit: LIMITS.totalBytes,
  },
};
if (process.argv.includes('--write'))
  await writeFile(
    'docs/release-transport-offline.json',
    JSON.stringify(result, null, 2) + '\n',
  );
console.log(JSON.stringify(result, null, 2));
