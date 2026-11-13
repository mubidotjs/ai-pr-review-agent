import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/analysis/diff';

describe('bounded unified diff parser', () => {
  it('maps additions, deletions, context and multiple hunks', () => {
    const parsed = parseDiff(
      '@@ -10,3 +10,3 @@ function checkout\n keep\n-old\n+new\n tail\n@@ -30 +30 @@\n-before\n+after',
      2,
      2,
    );
    expect(parsed.complete).toBe(true);
    expect(
      parsed.rows.filter((r) => r.kind === 'add').map((r) => r.newLine),
    ).toEqual([11, 30]);
    expect(
      parsed.rows.filter((r) => r.kind === 'delete').map((r) => r.oldLine),
    ).toEqual([11, 30]);
    expect(parsed.rows[1]).toMatchObject({
      oldLine: 10,
      newLine: 10,
      kind: 'context',
    });
  });
  it('handles pure addition/deletion and missing-newline markers', () => {
    expect(
      parseDiff('@@ -0,0 +1 @@\n+x\n\\ No newline at end of file', 1, 0)
        .complete,
    ).toBe(true);
    const deleted = parseDiff('@@ -1 +0,0 @@\n-x', 0, 1);
    expect(deleted.complete).toBe(true);
    expect(deleted.rows[1].newLine).toBeUndefined();
  });
  it.each([
    ['@@ -1,2 +1,2 @@\n a', 0, 0],
    ['@@ -1 +1 @@\n-old\n+new', 2, 1],
    ['garbage', 0, 0],
    ['@@ -0 +1 @@\n+x', 1, 0],
    ['@@ -1 +1 @@\n+new\n-old\n+extra', 2, 1],
    ['@@ -1 +1 @@\n a\n@@ -1 +1 @@\n a', 0, 0],
    ['@@ -9007199254740992 +1 @@\n-x\n+y', 1, 1],
    ['@@ -1 +1 @@\n?unknown', 0, 0],
  ] as const)(
    'rejects invalid or incomplete patch %s',
    (patch, additions, deletions) =>
      expect(parseDiff(patch, additions, deletions).complete).toBe(false),
  );
  it('distinguishes unavailable patches and explicit size/line limits', () => {
    expect(parseDiff(undefined, 0, 0).reason).toContain('unavailable');
    expect(parseDiff('x'.repeat(131073), 0, 0).reason).toContain('128 KiB');
    expect(parseDiff('@@ -0,0 +1,2 @@\n+a\n+b', 2, 0, 2).reason).toContain(
      'line budget',
    );
  });
  it('charges malformed patches against the parsing budget', () =>
    expect(parseDiff('@@ -1 +1 @@\n?invalid', 0, 0).lineCount).toBe(2));
  it('rejects coordinate ranges that overflow safe integers', () => {
    expect(
      parseDiff('@@ -0,0 +9007199254740991,2 @@\n+a\n+b', 2, 0).complete,
    ).toBe(false);
  });
});
