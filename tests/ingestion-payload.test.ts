import { expect, it } from 'vitest';
import { ingestionPayloadEnvelope } from './ingestion-payload-fixture';
import { LIMITS } from '../src/shared/types';
it('demonstrates a valid unchanged review response exceeding 4.5 MB without truncation', async () => {
  const envelope = await ingestionPayloadEnvelope();
  expect(envelope.frameBytes).toBeGreaterThan(4.5 * 1024 * 1024);
  expect(envelope.frameBytes).toBeLessThanOrEqual(LIMITS.snapshotBytes);
  expect(envelope.filePageBytes.every((n) => n <= LIMITS.responseBytes)).toBe(
    true,
  );
  expect(envelope.upstreamBytes).toBeLessThanOrEqual(LIMITS.totalBytes);
  expect(envelope.upstreamRequests).toBe(11);
  expect(envelope.sourceBytesEach).toBe(LIMITS.sourceBytes);
  expect(envelope.inventory).toBe(100);
  expect(envelope.contexts).toBe(6);
  expect(envelope.verified).toBe(true);
});
