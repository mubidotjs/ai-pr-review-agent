import type { DiffRow } from '../shared/types';
import { LIMITS } from '../shared/types';
import { byteLength } from './security';

export interface ParsedDiff {
  rows: DiffRow[];
  complete: boolean;
  reason?: string;
  lineCount: number;
}
export function parseDiff(
  patch: string | undefined,
  additions: number,
  deletions: number,
  remaining = LIMITS.diffLines as number,
): ParsedDiff {
  let attempted = 0;
  const fail = (reason: string): ParsedDiff => ({
    rows: [],
    complete: false,
    reason,
    lineCount: attempted,
  });
  if (!patch)
    return fail('Patch unavailable (binary, empty, or omitted by GitHub).');
  if (byteLength(patch) > LIMITS.patchBytes)
    return fail('Patch exceeds 128 KiB.');
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > remaining) return fail('Diff line budget exceeded.');
  attempted = lines.length;
  const rows: DiffRow[] = [];
  let old = 0,
    next = 0,
    oldLeft = 0,
    newLeft = 0,
    adds = 0,
    dels = 0;
  let active = false,
    lastOld = -1,
    lastNew = -1,
    lastBody = false;
  for (const line of lines) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (h) {
      if (active && (oldLeft !== 0 || newLeft !== 0))
        return fail('Truncated or inconsistent hunk.');
      old = Number(h[1]);
      next = Number(h[3]);
      oldLeft = Number(h[2] ?? 1);
      newLeft = Number(h[4] ?? 1);
      if (
        ![old, next, oldLeft, newLeft].every(Number.isSafeInteger) ||
        (oldLeft > 0 && oldLeft > Number.MAX_SAFE_INTEGER - old + 1) ||
        (newLeft > 0 && newLeft > Number.MAX_SAFE_INTEGER - next + 1) ||
        (oldLeft > 0 && old < 1) ||
        (newLeft > 0 && next < 1) ||
        old < lastOld ||
        next < lastNew
      )
        return fail('Invalid or overlapping source coordinates.');
      rows.push({ kind: 'hunk', text: line });
      active = true;
      lastBody = false;
      continue;
    }
    if (!active) return fail('Patch has no supported hunk header.');
    if (line === '\\ No newline at end of file' && lastBody) {
      rows.push({ kind: 'note', text: line });
      lastBody = false;
      continue;
    }
    if (line.startsWith('+')) {
      if (newLeft-- <= 0) return fail('Invalid added-line range.');
      rows.push({ kind: 'add', text: line.slice(1), newLine: next++ });
      adds++;
    } else if (line.startsWith('-')) {
      if (oldLeft-- <= 0) return fail('Invalid deleted-line range.');
      rows.push({ kind: 'delete', text: line.slice(1), oldLine: old++ });
      dels++;
    } else if (line.startsWith(' ')) {
      if (oldLeft-- <= 0 || newLeft-- <= 0)
        return fail('Invalid context range.');
      rows.push({
        kind: 'context',
        text: line.slice(1),
        oldLine: old++,
        newLine: next++,
      });
    } else return fail('Unrecognized diff row.');
    lastOld = old;
    lastNew = next;
    lastBody = true;
  }
  if (
    !active ||
    oldLeft !== 0 ||
    newLeft !== 0 ||
    adds !== additions ||
    dels !== deletions
  )
    return fail('Patch is incomplete or counts do not match GitHub metadata.');
  return { rows, complete: true, lineCount: lines.length };
}
