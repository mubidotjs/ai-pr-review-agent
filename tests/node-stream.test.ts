import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/index';
import { serializeSnapshot } from '../src/server/review';
import { LIMITS } from '../src/shared/types';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { analyzeSnapshot } from '../src/analysis/review';
import { createIngestionPayloadFixture } from './ingestion-payload-fixture';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import baseline from './baseline-demo.json';
import { localNodeRoute } from './node-http';
import { maximumFrameSnapshot, referenceFrame } from './node-stream-fixtures';
import { SNAPSHOT_MEDIA_TYPE } from '../src/server/node-adapter';

const post = (origin: string) =>
  fetch(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: PR_URL }),
  });
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const frameResponse = (snapshot: ReturnType<typeof maximumFrameSnapshot>) => {
  const result = serializeSnapshot(snapshot);
  return new Response(result.body, {
    headers: {
      'Content-Type': SNAPSHOT_MEDIA_TYPE,
      'Content-Length': String(result.bytes),
    },
  });
};

describe('actual local Node HTTP route and binary framing', () => {
  it('preserves findings, source links, coverage and Markdown through Node', async () => {
    const app = createApp(fixtureTransport()),
      route = await localNodeRoute((r) => app.fetch(r));
    try {
      const response = await post(route.origin);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-length')).toBeNull();
      expect(response.headers.get('transfer-encoding')).toBe('chunked');
      const result = analyzeSnapshot(
        decodeSnapshotWire(await response.arrayBuffer()),
      );
      expect(result.review.findings).toEqual(baseline.findings);
      expect(result.review.coverage).toEqual(baseline.coverage);
      expect(result.review.provenance?.serverAttested).toBe(false);
      expect(result.review.ai.status).toBe('disabled');
      expect(result.markdown).toContain('no server attestation');
    } finally {
      await route.close();
    }
  });

  it('streams the exact 4,752,446-byte ingestion fixture with matching hash and EOF', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1900000000000);
    const uuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000000');
    const fixture = createIngestionPayloadFixture(),
      app = createApp((input, init) => {
        clock.mockReturnValue(1900000000100);
        return fixture.transport(input, init);
      });
    const request = new Request('http://127.0.0.1/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PR_URL }),
    });
    const expected = new Uint8Array(
      await (await app.fetch(request)).arrayBuffer(),
    );
    const route = await localNodeRoute((r) => app.fetch(r));
    try {
      clock.mockReturnValue(1900000000000);
      const response = await post(route.origin),
        actual = new Uint8Array(await response.arrayBuffer());
      expect(actual.length).toBe(4752446);
      expect(response.headers.get('x-prism-snapshot-bytes')).toBe('4752446');
      expect(hash(actual)).toBe(hash(expected));
      const snapshot = decodeSnapshotWire(actual.buffer) as {
        files: { context?: unknown }[];
        verification: { after: unknown };
        budget: { requests: number };
      };
      expect(snapshot.files).toHaveLength(100);
      expect(snapshot.files.filter((f) => f.context)).toHaveLength(6);
      expect(snapshot.verification.after).not.toBeNull();
      expect(snapshot.budget.requests).toBe(11);
    } finally {
      clock.mockRestore();
      uuid.mockRestore();
      await route.close();
    }
  });

  it('streams exactly 12 MiB with independent byte-order/hash oracle and unchanged decoder', async () => {
    const snapshot = maximumFrameSnapshot(),
      expected = referenceFrame(snapshot);
    const route = await localNodeRoute(() => frameResponse(snapshot));
    try {
      const response = await post(route.origin),
        actual = new Uint8Array(await response.arrayBuffer());
      expect(actual.byteLength).toBe(LIMITS.snapshotBytes);
      expect(hash(actual)).toBe(hash(expected));
      const decoded = decodeSnapshotWire(actual.buffer) as {
        pr: { description: string };
        files: unknown[];
      };
      expect(decoded.pr.description).toBe(snapshot.pr.description);
      expect(decoded.files).toHaveLength(100);
      // The same unchanged pipeline accepts the synthetic snapshot and honest partial coverage.
      const result = analyzeSnapshot(decoded);
      expect(result.review.coverage).toEqual({
        total: 100,
        inventoried: 100,
        analyzed: 6,
        skipped: 94,
        uninventoried: 0,
      });
    } finally {
      await route.close();
    }
  });

  it('delivers prefix bytes before the producer releases a delayed tail (no full-response buffering)', async () => {
    let release!: () => void,
      cancelled = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pulls = 0;
    const route = await localNodeRoute(
      () =>
        new Response(
          new ReadableStream(
            {
              async pull(controller) {
                if (pulls++ === 0)
                  controller.enqueue(new Uint8Array([0, 0, 0, 1]));
                else {
                  await gate;
                  if (!cancelled) {
                    controller.enqueue(new Uint8Array([123]));
                    controller.close();
                  }
                }
              },
              cancel() {
                cancelled = true;
                release();
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'Content-Type': SNAPSHOT_MEDIA_TYPE } },
        ),
    );
    try {
      const response = await post(route.origin),
        reader = response.body!.getReader();
      const first = await Promise.race([
        reader.read(),
        pause(1000).then(() => {
          throw new Error('Buffered until tail');
        }),
      ]);
      expect(Array.from(first.value!)).toEqual([0, 0, 0, 1]);
      release();
      const rest: number[] = [];
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        rest.push(...item.value);
      }
      expect(rest).toEqual([123]);
    } finally {
      release();
      await route.close();
    }
  });

  it('backpressures a 12-MiB producer when a real HTTP client pauses reading, and cancels it on disconnect', async () => {
    let pulls = 0,
      cancelled = false;
    const route = await localNodeRoute(
      () =>
        new Response(
          new ReadableStream(
            {
              pull(controller) {
                pulls++;
                if (pulls <= 192) controller.enqueue(new Uint8Array(65536));
                else controller.close();
              },
              cancel() {
                cancelled = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'Content-Type': SNAPSHOT_MEDIA_TYPE } },
        ),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const request = httpRequest(
          `${route.origin}/api/review`,
          { method: 'POST' },
          (response) => {
            response.pause();
            void (async () => {
              await pause(80);
              const first = pulls;
              await pause(80);
              expect(pulls).toBeLessThan(192);
              expect(pulls - first).toBeLessThanOrEqual(2);
              response.destroy();
              request.destroy();
              await vi.waitFor(() => expect(cancelled).toBe(true));
              resolve();
            })().catch(reject);
          },
        );
        request.on('error', (error) => {
          if (!cancelled) reject(error);
        });
        request.end();
      });
    } finally {
      await route.close();
    }
  });
});
