import { serializeSnapshot } from '../src/server/review';
import { LIMITS, type ReviewInputSnapshot } from '../src/shared/types';
import { addition, pr, HEAD, BASE } from './upstream-fixtures';

// Exact transport ceiling. This deliberately bypasses upstream acquisition:
// a 12-MiB envelope is not claimed reachable through the 8-MiB upstream budget.
export function maximumFrameSnapshot(): ReviewInputSnapshot {
  const files = Array.from({ length: 100 }, (_, i) => {
    if (i < 6) {
      const path = `src/check${i}.ts`,
        text = `export const check${i} = (v: number) => v === NaN; // UTF-8: λ 🧪`;
      return {
        ...addition(path, text),
        context: { repository: pr.headRepo!.fullName, sha: HEAD, path, text },
      };
    }
    const prefix = '@@ -0,0 +1 @@\n+';
    return {
      path: `docs/file${i}.txt`,
      status: 'added',
      additions: 1,
      deletions: 0,
      patch: prefix + 'x'.repeat(LIMITS.patchBytes - prefix.length),
    };
  });
  const identity = {
    baseSha: BASE,
    headSha: HEAD,
    changedFiles: files.length,
    headRepo: pr.headRepo!.fullName,
  };
  const snapshot: ReviewInputSnapshot = {
    schemaVersion: 1,
    id: 'maximum-frame-synthetic',
    synthetic: true,
    pr: {
      ...pr,
      title: 'Synthetic transport ceiling',
      description: '',
      changedFiles: 100,
      additions: 100,
      deletions: 0,
    },
    files,
    verification: { before: identity, after: identity },
    notices: [],
    budget: {
      requests: 11,
      bytes: 0,
      contextFiles: 6,
      diffLines: 0,
      durationMs: 0,
    },
    rateLimit: {},
  };
  const initial = serializeSnapshot(snapshot);
  void initial.body.cancel();
  snapshot.pr.description = 'p'.repeat(LIMITS.snapshotBytes - initial.bytes);
  if (snapshot.pr.description.length > 262144)
    throw new Error('Invalid fixture description bound');
  return snapshot;
}

// Independent byte-order oracle, used only in tests; production never concatenates.
export function referenceFrame(snapshot: ReviewInputSnapshot): Buffer {
  const contexts: Buffer[] = [];
  const metadata = {
    ...snapshot,
    files: snapshot.files.map(({ context, ...file }) => {
      if (!context) return file;
      const text = Buffer.from(context.text, 'utf8');
      contexts.push(text);
      return {
        ...file,
        context: {
          repository: context.repository,
          sha: context.sha,
          path: context.path,
          bytes: text.length,
        },
      };
    }),
  };
  const json = Buffer.from(JSON.stringify(metadata)),
    header = Buffer.alloc(4);
  header.writeUInt32BE(json.length);
  return Buffer.concat([header, json, ...contexts]);
}
