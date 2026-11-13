import { describe, expect, it, vi } from 'vitest';
import { createCpuHarness } from './platform-cpu-harness';
import { CPU_CASES } from './platform-cpu-fixtures';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { PR_URL } from './upstream-fixtures';
import type { ReviewInputSnapshot } from '../src/shared/types';

const secret = 'synthetic-test-secret-'.repeat(3);
const env = {
  CPU_PROBE_SECRET: secret,
  CPU_PROBE_EXPIRES: String(Date.now() + 600000),
};
const request = (
  name = 'small-1',
  auth = `Bearer ${secret}`,
  body = JSON.stringify({ url: PR_URL }),
) =>
  new Request('https://isolated.example/api/review', {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
      'X-Prism-Cpu-Case': name,
    },
    body,
  });

describe('isolated platform CPU harness', () => {
  it('fails closed without a secret, with wrong auth, and after expiry', async () => {
    const app = createCpuHarness();
    expect((await app.fetch(request(), {})).status).toBe(401);
    expect(
      (await app.fetch(request('small-1', 'Bearer wrong'), env)).status,
    ).toBe(401);
    expect(
      (await app.fetch(request(), { ...env, CPU_PROBE_EXPIRES: '0' })).status,
    ).toBe(410);
    expect(
      (await app.fetch(request(), { ...env, CPU_PROBE_EXPIRES: 'NaN' })).status,
    ).toBe(410);
  });
  it('has no health bypass, arbitrary scenario, URL proxy or arbitrary source endpoint', async () => {
    const app = createCpuHarness();
    expect((await app.fetch(request('arbitrary'), env)).status).toBe(404);
    expect(
      (await app.fetch(new Request('https://isolated.example/api/health'), env))
        .status,
    ).toBe(401);
    expect(
      (
        await app.fetch(
          request(
            'small-1',
            `Bearer ${secret}`,
            JSON.stringify({ url: 'https://evil.example/' }),
          ),
          env,
        )
      ).status,
    ).toBe(400);
    const oversized = await app.fetch(
      request('small-1', `Bearer ${secret}`, 'x'.repeat(2049)),
      env,
    );
    expect(oversized.status).toBe(413);
  });
  it('exercises unchanged ingestion without any network or model call', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden'));
    try {
      const app = createCpuHarness();
      for (const name of CPU_CASES) {
        const response = await app.fetch(request(name), env);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        if (name === 'malformed') {
          expect(response.status).toBe(502);
          expect((await response.json()).error.code).toBe('INVALID_UPSTREAM');
          continue;
        }
        expect(response.status).toBe(200);
        const snapshot = decodeSnapshotWire(
          await response.arrayBuffer(),
        ) as ReviewInputSnapshot;
        expect(snapshot.verification.after).not.toBeNull();
        expect(snapshot.budget.requests).toBeLessThanOrEqual(12);
        expect(snapshot.files.length).toBe(
          name === 'paginated-100'
            ? 100
            : name === 'small-1'
              ? 1
              : name === 'small-4'
                ? 4
                : 6,
        );
        const count = snapshot.files.filter((f) => f.context).length;
        expect(count).toBe(
          name === 'small-1'
            ? 1
            : name === 'small-4' || name === 'incomplete'
              ? 4
              : name === 'missing-source' || name === 'oversized-source'
                ? 5
                : 6,
        );
        if (name === 'paginated-100') expect(snapshot.budget.requests).toBe(11);
      }
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it('labels first authorized request only and caps requests per isolate', async () => {
    const app = createCpuHarness();
    const first = await app.fetch(request(), env);
    expect(first.headers.get('X-Prism-Cpu-First-Request')).toBe('true');
    const id = first.headers.get('X-Prism-Cpu-Isolate');
    for (let i = 1; i < 200; i++) {
      const response = await app.fetch(request('malformed'), env);
      expect(response.headers.get('X-Prism-Cpu-First-Request')).toBe('false');
      expect(response.headers.get('X-Prism-Cpu-Isolate')).toBe(id);
    }
    expect((await app.fetch(request(), env)).status).toBe(429);
  });
});
