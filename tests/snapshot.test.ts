import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { describe, expect, it, vi } from 'vitest';
import * as rules from '../src/analysis/rules';
import {
  createDemoInput,
  createDemo,
  addition,
  sources,
  PR_URL,
  fixtureTransport,
} from './fixtures';
import { analyzeSnapshot } from '../src/analysis/review';
import { validateSnapshot } from '../src/analysis/snapshot';
import { ingestPullRequest, serializeSnapshot } from '../src/server/review';
import { GitHubClient } from '../src/server/github';
import { LIMITS } from '../src/shared/types';
import { scanPatch } from '../src/shared/patch';
import { parseDiff } from '../src/analysis/diff';
import bundledDemo from '../src/client/demo-input.json';

describe('versioned snapshot boundary and deterministic parity', () => {
  it('keeps per-file unexpected parser failures incomplete without losing other evidence', () => {
    const input = createDemoInput();
    const spy = vi.spyOn(rules, 'analyzeFile').mockImplementationOnce(() => {
      throw new RangeError('Pathological AST');
    });
    try {
      const result = analyzeSnapshot(input);
      expect(result.review.coverage.analyzed).toBe(4);
      expect(result.review.findings).toHaveLength(2);
      expect(result.review.files[0].reason).toContain(
        'Unexpected analysis failure',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('keeps the bundled offline input synchronized with validated fixtures', () =>
    expect(bundledDemo).toEqual(createDemoInput()));
  it('retains every seeded finding, exact coordinates, severity, and coverage', () => {
    const result = analyzeSnapshot(createDemoInput());
    expect(result.review.findings).toEqual(createDemo().findings);
    expect(result.review.coverage).toEqual(createDemo().coverage);
    expect(result.review.provenance).toEqual({
      analysis: 'browser-worker',
      serverAttested: false,
    });
    expect(result.markdown).toContain('no server attestation');
  });
  it('preflight and materialized diff parsing have identical eligibility and line budgets', () => {
    for (const patch of [
      '@@ -0,0 +1 @@\n+value === NaN;',
      '@@ -1 +1 @@\n-x\n+y',
      '@@ -1,3 +1,3 @@\n x',
      undefined,
    ]) {
      const inspected = scanPatch(patch, 1, patch?.includes('-x') ? 1 : 0);
      const parsed = parseDiff(patch, 1, patch?.includes('-x') ? 1 : 0);
      expect(inspected.rows).toEqual([]);
      expect({ ...parsed, rows: [] }).toEqual(inspected);
    }
  });
  it.each([
    'version',
    'sha',
    'repository',
    'path',
    'counter',
    'url',
    'duplicate',
    'too-many-contexts',
    'bytes',
  ])('rejects mutated %s snapshots', (kind) => {
    const snapshot = structuredClone(createDemoInput());
    if (kind === 'version') Object.assign(snapshot, { schemaVersion: 2 });
    if (kind === 'sha') snapshot.files[0].context!.sha = 'c'.repeat(40);
    if (kind === 'repository')
      snapshot.files[0].context!.repository = 'evil/other';
    if (kind === 'path') snapshot.files[0].context!.path = 'src/other.ts';
    if (kind === 'counter') snapshot.budget.requests = 13;
    if (kind === 'url') snapshot.pr.url = 'https://evil.test';
    if (kind === 'duplicate') snapshot.files[1].path = snapshot.files[0].path;
    if (kind === 'too-many-contexts') {
      snapshot.files.push(
        ...snapshot.files.slice(0, 2).map((f, i) => ({
          ...f,
          path: `other${i}.ts`,
          context: { ...f.context!, path: `other${i}.ts` },
        })),
      );
      snapshot.pr.changedFiles = 10;
      snapshot.verification.before.changedFiles = 10;
      snapshot.verification.after!.changedFiles = 10;
    }
    if (kind === 'bytes') snapshot.files[0].context!.text = '😀'.repeat(40000);
    expect(() => validateSnapshot(snapshot)).toThrow();
  });
  it('rejects inconsistent before/after snapshots and unknown data fields', () => {
    const snapshot = createDemoInput();
    snapshot.verification.after = {
      ...snapshot.verification.after!,
      headSha: 'c'.repeat(40),
    };
    expect(() => validateSnapshot(snapshot)).toThrow();
    expect(() =>
      validateSnapshot({ ...createDemoInput(), token: 'forbidden' }),
    ).toThrow();
  });
  it('retains source checks after structural validation and cannot create attestation', () => {
    const snapshot = createDemoInput();
    snapshot.files[0].context!.text = 'export const unrelated = true;';
    const result = analyzeSnapshot(snapshot);
    expect(result.review.files[0].reason).toContain('does not match');
    expect(result.review.findings).toHaveLength(2);
    expect(result.review.provenance?.serverAttested).toBe(false);
  });
  it('backend returns only input data, omits oversized patches and enforces response limits', async () => {
    const snapshot = await ingestPullRequest(
      PR_URL,
      new GitHubClient(fixtureTransport()),
    );
    expect('findings' in snapshot).toBe(false);
    expect('rows' in snapshot.files[0]).toBe(false);
    expect(snapshot.files[6].patch).toBeUndefined();
    expect(snapshot.files[6].patchOmitted).toBe('oversized');
    const encoded = serializeSnapshot(snapshot);
    expect(
      (
        decodeSnapshotWire(await new Response(encoded.body).arrayBuffer()) as {
          schemaVersion: number;
        }
      ).schemaVersion,
    ).toBe(1);
    expect(() =>
      serializeSnapshot({
        ...snapshot,
        notices: ['x'.repeat(LIMITS.snapshotBytes)],
      }),
    ).toThrow('snapshot response limit');
  });
  it('does not consume source slots on invalid patches before six valid files', async () => {
    const valid = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        `src/a${i}.ts`,
        `export const n${i} = value === NaN;`,
      ]),
    );
    const files = [
      {
        path: 'src/bad.ts',
        status: 'added',
        patch: '@@ -0,0 +1,2 @@\n+incomplete',
        additions: 2,
        deletions: 0,
      },
      ...Object.entries(valid).map(([p, s]) => addition(p, s)),
    ];
    const snapshot = await ingestPullRequest(
      PR_URL,
      new GitHubClient(fixtureTransport(files, { ...sources, ...valid })),
    );
    expect(snapshot.budget.contextFiles).toBe(6);
    expect(snapshot.budget.requests).toBe(10);
    expect(analyzeSnapshot(snapshot).review.coverage.analyzed).toBe(6);
  });
  it('checks framing lengths, exact EOF, and UTF-8 before analysis', async () => {
    const encoded = serializeSnapshot(createDemoInput());
    const buffer = await new Response(encoded.body).arrayBuffer();
    expect(
      analyzeSnapshot(decodeSnapshotWire(buffer)).review.findings,
    ).toHaveLength(3);
    const truncated = buffer.slice(0, buffer.byteLength - 1);
    expect(() => decodeSnapshotWire(truncated)).toThrow();
    const trailing = new Uint8Array(buffer.byteLength + 1);
    trailing.set(new Uint8Array(buffer));
    expect(() => decodeSnapshotWire(trailing.buffer)).toThrow();
    const badLength = buffer.slice(0);
    new DataView(badLength).setUint32(0, 0xffffffff);
    expect(() => decodeSnapshotWire(badLength)).toThrow();
    const invalidUtf8 = buffer.slice(0);
    new Uint8Array(invalidUtf8)[invalidUtf8.byteLength - 1] = 255;
    expect(() => decodeSnapshotWire(invalidUtf8)).toThrow();
  });
});
