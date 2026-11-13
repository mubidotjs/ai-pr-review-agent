import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { PR_URL } from './fixtures';

describe('actual local workerd runtime', () => {
  let worker: Unstable_DevWorker;
  beforeAll(async () => {
    worker = await unstable_dev('tests/worker-harness.ts', {
      config: 'wrangler.test.jsonc',
      ip: '127.0.0.1',
      port: 0,
      inspectorPort: 0,
      local: true,
      logLevel: 'error',
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
  }, 60000);
  afterAll(async () => {
    await worker?.stop();
  });
  it('uses a native-fetch redirect mode supported by workerd', async () => {
    const response = await worker.fetch(
      `http://${worker.address}:${worker.port}/native-fetch-check`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ native: true });
  });
  it('rejects native redirects without following them', async () => {
    const response = await worker.fetch(
      `http://${worker.address}:${worker.port}/native-redirect-check`,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('redirects are not followed'),
    });
  });
  it('executes the complete Worker route against synthetic upstream responses', async () => {
    const response = await worker.fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PR_URL }),
    });
    expect(response.status).toBe(200);
    const review = decodeSnapshotWire(await response.arrayBuffer()) as {
      schemaVersion: number;
      files: { context?: unknown }[];
      verification: { before: unknown; after: unknown };
      findings?: unknown;
    };
    expect(review.schemaVersion).toBe(1);
    expect(review.files.filter((f) => f.context)).toHaveLength(5);
    expect(review.verification.after).toEqual(review.verification.before);
    expect(review.findings).toBeUndefined();
  });
  it('keeps six near-128-KiB sources functional locally', async () => {
    const response = await worker.fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-benchmark': 'large' },
      body: JSON.stringify({ url: PR_URL }),
    });
    expect(response.status).toBe(200);
    const review = decodeSnapshotWire(await response.arrayBuffer()) as {
      files: { context?: unknown }[];
      findings?: unknown;
    };
    expect(review.files.filter((f) => f.context)).toHaveLength(6);
    expect(review.findings).toBeUndefined();
  });
});
