import { describe, expect, it } from 'vitest';
import {
  boundedText,
  parsePullRequestUrl,
  repoPath,
  safePath,
  sourceUrl,
} from '../src/server/security';
import { markdownText, reviewReport } from '../src/shared/report';
import { createDemo, HEAD, PR_URL } from './fixtures';

describe('URL and source security', () => {
  it('accepts only canonical public PR coordinates', () => {
    expect(parsePullRequestUrl(PR_URL + '/')).toEqual({
      owner: 'example',
      repo: 'checkout',
      number: 42,
      url: PR_URL,
    });
  });
  it.each([
    'http://github.com/a/b/pull/1',
    'https://github.com.evil.test/a/b/pull/1',
    'https://github.com@evil.test/a/b/pull/1',
    'https://evil@github.com/a/b/pull/1',
    'https://github.com:443/a/b/pull/1',
    'https://github.com/a/b/pull/1?x=1',
    'https://github.com/a/b/pull/1#files',
    'https://api.github.com/a/b/pull/1',
    'https://github.com/a/b/issues/1',
    'https://github.com/a/b/pull/0',
    'https://github.com/a/b/pull/-1',
    'https://github.com/a/b/pull/01',
    'https://github.com/a/b/pull/9007199254740992',
    'https://github.com/a/b/pull/1/files',
    'https://github.com/a/../b/pull/1',
    'https://github.com/a/%2e%2e/pull/1',
    'https://github.com/a%2fb/c/pull/1',
    'https://github.com/a/b\\pull/1',
    'https://github.com/-a/b/pull/1',
    'https://github.com/a--b/c/pull/1',
    'https://127.0.0.1/a/b/pull/1',
    'https://[::1]/a/b/pull/1',
    'file:///a/b/pull/1',
    'https://GITHUB.COM/a/b/pull/1',
  ])('rejects %s', (url) => expect(() => parsePullRequestUrl(url)).toThrow());
  it.each([
    '../x',
    '/absolute',
    'a/./b',
    'a//b',
    'a\\b',
    'a\u0000b',
    'a/..',
    'x'.repeat(2049),
  ])('rejects unsafe context path %s', (path) =>
    expect(safePath(path)).toBe(false),
  );
  it('encodes filenames as segments and rejects private repositories', () => {
    expect(
      sourceUrl(
        { fullName: 'fork/project', private: false },
        HEAD,
        'src/a #?.ts',
        7,
      ),
    ).toBe(`https://github.com/fork/project/blob/${HEAD}/src/a%20%23%3F.ts#L7`);
    expect(() =>
      repoPath({ fullName: 'owner/private', private: true }),
    ).toThrow();
    expect(() =>
      repoPath({ fullName: 'owner/repo/extra', private: false }),
    ).toThrow();
    expect(() =>
      sourceUrl({ fullName: 'owner/repo', private: false }, 'main', 'a.ts', 1),
    ).toThrow();
  });
  it('bounds streamed UTF-8 bytes rather than JavaScript string length', async () => {
    await expect(boundedText(new Response('😀😀'), 7)).rejects.toThrow(
      'byte limit',
    );
    expect(await boundedText(new Response('😀😀'), 8)).toBe('😀😀');
    await expect(
      boundedText(new Response(new Uint8Array([255])), 10),
    ).rejects.toThrow();
  });
  it('cancels stalled stream reads', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ start() {} }));
    const reading = boundedText(response, 10, undefined, controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow('cancelled');
  });
  it('rejects an already-aborted stalled body before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      boundedText(
        new Response(new ReadableStream({ start() {} })),
        10,
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow('before it started');
  });
});
describe('report sanitization', () => {
  it('escapes active HTML, link syntax, fences, and controls', () => {
    const unsafe =
      '<script>alert(1)</script>\n```\n[click](javascript:alert(1))\u0000';
    const escaped = markdownText(unsafe);
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('```');
    expect(escaped).not.toContain('[click](');
    expect(escaped).not.toContain('\u0000');
  });
  it('exports real evidence, provenance, coverage, SHA, and limitations', () => {
    const demo = createDemo();
    const report = reviewReport(demo);
    expect(report).toContain(
      '8 total; 8 inventoried; 5 analyzed; 3 skipped; 0 uninventoried',
    );
    expect(report).toContain('Synthetic demonstration');
    expect(report).toContain(HEAD);
    expect(report).toContain('AI disabled');
    expect(report).toContain('not a security clearance');
    expect(report).toContain('jsonwebtoken');
  });
});
