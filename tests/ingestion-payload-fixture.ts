import { GitHubClient } from '../src/server/github';
import { ingestPullRequest, serializeSnapshot } from '../src/server/review';
import { LIMITS } from '../src/shared/types';
import { apiFile, apiPr, fixtureTransport, PR_URL } from './upstream-fixtures';

// Byte-size assessment only. No CPU/timing benchmark, network, or inference.
export function createIngestionPayloadFixture() {
  const prefix = 'export const example = "',
    suffix = '";';
  const line =
    prefix + 'x'.repeat(36 * 1024 - prefix.length - suffix.length) + suffix;
  const source =
    line + '\n//' + 'p'.repeat(LIMITS.sourceBytes - line.length - 3);
  const files = Array.from({ length: 100 }, (_, i) => ({
    path: `src/file${i}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: `@@ -0,0 +1 @@\n+${line}`,
  }));
  const metadata = apiPr({
    changed_files: files.length,
    body: 'd'.repeat(262144),
    additions: 100,
    deletions: 0,
  });
  const contexts = Object.fromEntries(
    files.slice(0, 6).map((f) => [f.path, source]),
  );
  return {
    files,
    metadata,
    contexts,
    transport: fixtureTransport(files, contexts, metadata),
  };
}
export async function ingestionPayloadEnvelope() {
  const { files, transport } = createIngestionPayloadFixture();
  const client = new GitHubClient(transport);
  const snapshot = await ingestPullRequest(PR_URL, client);
  const frame = serializeSnapshot(snapshot);
  await frame.body.cancel();
  const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return {
    method:
      'Synthetic size-only example through unchanged bounded ingestion and framing; no timing or CPU measurements.',
    configuredSnapshotCeiling: LIMITS.snapshotBytes,
    frameBytes: frame.bytes,
    decimal4_5MB: 4500000,
    binary4_5MiB: 4.5 * 1024 * 1024,
    exceedsBothInterpretations: frame.bytes > 4.5 * 1024 * 1024,
    filePageBytes: [
      bytes(files.slice(0, 50).map(apiFile)),
      bytes(files.slice(50).map(apiFile)),
    ],
    sourceBytesEach: LIMITS.sourceBytes,
    inventory: snapshot.files.length,
    contexts: snapshot.files.filter((f) => f.context).length,
    verified: !!snapshot.verification.after,
    upstreamRequests: client.requests,
    upstreamBytes: client.bytes,
  };
}
