import { expect, it } from 'vitest';
import { ingestionEnvelopeBound } from '../scripts/vercel-transport/envelope';
import { LIMITS } from '../src/shared/types';
import { GitHubClient } from '../src/server/github';
import { ingestPullRequest } from '../src/server/review';
import { validateSnapshot } from '../src/analysis/snapshot';
import { maximumFrameSnapshot, referenceFrame } from './node-stream-fixtures';
import { createIngestionPayloadFixture } from './ingestion-payload-fixture';
import { apiFile, fixtureTransport, PR_URL } from './upstream-fixtures';

it('bounds valid ingestion below 12 MiB without weakening any acquisition limit', async () => {
  const bound = ingestionEnvelopeBound();
  expect(bound.conservativeFrameBound).toBe(8126464);
  expect(bound.conservativeFrameBound).toBeLessThan(LIMITS.snapshotBytes);
  expect(bound.generatedFieldBound).toBeLessThan(bound.generatedFieldAllowance);
  const fixture = createIngestionPayloadFixture();
  // Max-length adversarial JSON escaping in metadata, not just ASCII estimates.
  fixture.metadata.title = '\u0000'.repeat(16384);
  fixture.metadata.body = '\u0000'.repeat(262144);
  const client = new GitHubClient(
    fixtureTransport(fixture.files, fixture.contexts, fixture.metadata),
  );
  const snapshot = validateSnapshot(await ingestPullRequest(PR_URL, client));
  expect(snapshot.files).toHaveLength(100);
  expect(snapshot.files.filter((f) => f.context)).toHaveLength(6);
  expect(client.requests).toBe(11);
  expect(client.bytes).toBeLessThanOrEqual(LIMITS.totalBytes);
  expect(referenceFrame(snapshot).length).toBeLessThan(
    bound.conservativeFrameBound,
  );
  expect(snapshot.pr.description).toBe(fixture.metadata.body);
});

it('shows why the 12-MiB fixture is valid framing but impossible upstream acquisition', () => {
  const snapshot = maximumFrameSnapshot();
  validateSnapshot(snapshot);
  expect(referenceFrame(snapshot).length).toBe(LIMITS.snapshotBytes);
  const pages = [snapshot.files.slice(0, 50), snapshot.files.slice(50)].map(
    (files) => Buffer.byteLength(JSON.stringify(files.map(apiFile))),
  );
  expect(pages.every((bytes) => bytes > LIMITS.responseBytes)).toBe(true);
  expect(pages.reduce((a, b) => a + b, 0)).toBeGreaterThan(LIMITS.totalBytes);
});
