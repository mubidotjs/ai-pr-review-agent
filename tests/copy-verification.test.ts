import { describe, expect, it } from 'vitest';
import {
  compareClipboard,
  safeCopyError,
} from '../scripts/release/verify-copy';

describe('copy acceptance without leaking report or browser exception content', () => {
  it('accepts exact LF and only Windows CRLF conversion', () => {
    expect(compareClipboard('α\n\nB\n', 'α\n\nB\n').rawExact).toBe(true);
    const windows = compareClipboard('α\n\nB\n', 'α\r\n\r\nB\r\n');
    expect(windows.canonicalExact).toBe(true);
    expect(windows.rawExact).toBe(false);
    expect(windows.canonicalClipboardSha256).toBe(windows.expectedSha256);
  });
  it.each(['α\nB\n', 'α\n\nB', 'α\n\nB \n', 'α\r\n\rB\n', 'a\n\nB\n'])(
    'rejects other changes, including whitespace and bare CR',
    (text) =>
      expect(compareClipboard('α\n\nB\n', text).canonicalExact).toBe(false),
  );
  it('exposes stage/name and a fixed message rather than arbitrary exception data', () => {
    const error = new Error('secret source and credentials');
    error.name = 'TypeError';
    expect(safeCopyError('clipboard-read', error)).toEqual({
      stage: 'clipboard-read',
      exceptionName: 'TypeError',
      sanitizedMessage: 'Browser operation failed; exception content omitted.',
    });
    expect(JSON.stringify(safeCopyError('copy-click', error))).not.toContain(
      'secret',
    );
    expect(
      safeCopyError('clipboard-compare', new Error('COPY_MISMATCH')),
    ).toMatchObject({
      sanitizedMessage:
        'Clipboard text differs beyond Windows CRLF conversion.',
    });
  });
});
