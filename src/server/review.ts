import { LIMITS, type ReviewInputSnapshot } from '../shared/types';
import { ineligibleReason, identity } from '../shared/eligibility';
import { scanPatch } from '../shared/patch';
import { byteLength, parsePullRequestUrl, ReviewError } from './security';
import { GitHubClient } from './github';

const message = (error: unknown) =>
  error instanceof ReviewError
    ? `${error.code}: ${error.message}`
    : 'Source unavailable; no speculative findings.';

// No Babel, findings, report generation, or AST analysis on the backend path.
export async function ingestPullRequest(
  url: string,
  client = new GitHubClient(),
): Promise<ReviewInputSnapshot> {
  const ref = parsePullRequestUrl(url);
  await client.verifyPublicRepository(ref);
  const pr = await client.getPullRequest(ref);
  const snapshot: ReviewInputSnapshot = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    pr,
    files: [],
    verification: { before: identity(pr), after: null },
    notices: [],
    budget: {
      requests: 0,
      bytes: 0,
      contextFiles: 0,
      diffLines: 0,
      durationMs: 0,
    },
    rateLimit: {},
  };
  try {
    for (
      let page = 1;
      page <= 2 && snapshot.files.length < pr.changedFiles;
      page++
    ) {
      const files = await client.listChangedFiles(ref, page);
      snapshot.files.push(...files);
      if (files.length < 50) break;
    }
  } catch (error) {
    snapshot.notices.push(message(error));
  }
  if (
    snapshot.files.length > pr.changedFiles ||
    new Set(snapshot.files.map((f) => f.path)).size !== snapshot.files.length
  )
    throw new ReviewError(
      'INCONSISTENT_INVENTORY',
      'File inventory is inconsistent; retry a fresh snapshot.',
      409,
    );
  let lines = 0;
  for (const file of snapshot.files) {
    const preflight = scanPatch(
      file.patch,
      file.additions,
      file.deletions,
      LIMITS.diffLines - lines,
    );
    lines += preflight.lineCount;
    const reason = ineligibleReason(file, pr, preflight.reason);
    if (byteLength(file.patch ?? '') > LIMITS.patchBytes) {
      file.patch = undefined;
      file.patchOmitted = 'oversized';
    }
    if (reason) continue;
    if (snapshot.budget.contextFiles >= LIMITS.contextFiles) {
      file.contextReason = 'Six-file source-context budget reached.';
      continue;
    }
    try {
      client.assertBudget();
      if (
        client.rateLimit.remaining !== undefined &&
        client.rateLimit.remaining <= 1
      ) {
        file.contextReason =
          'Remaining GitHub quota reserved for snapshot verification.';
        continue;
      }
      snapshot.budget.contextFiles++;
      const text = await client.readFileContext(pr, file.path);
      file.context = {
        repository: pr.headRepo!.fullName,
        sha: pr.headSha,
        path: file.path,
        text,
      };
    } catch (error) {
      file.contextReason = message(error);
    }
  }
  try {
    const current = await client.getPullRequest(ref, true);
    const before = snapshot.verification.before,
      after = identity(current);
    if (
      before.baseSha !== after.baseSha ||
      before.headSha !== after.headSha ||
      before.changedFiles !== after.changedFiles ||
      before.headRepo !== after.headRepo
    )
      throw new ReviewError(
        'PR_CHANGED',
        'PR snapshot changed during review. Run a fresh review.',
        409,
      );
    snapshot.verification.after = after;
  } catch (error) {
    if (error instanceof ReviewError && error.code === 'PR_CHANGED')
      throw error;
    snapshot.notices.push(
      `Final snapshot verification unavailable. ${message(error)}`,
    );
    for (const file of snapshot.files) delete file.context;
  }
  snapshot.budget = {
    ...snapshot.budget,
    requests: client.requests,
    bytes: client.bytes,
    durationMs: Date.now() - client.started,
  };
  snapshot.rateLimit = { ...client.rateLimit };
  return snapshot;
}
export function serializeSnapshot(snapshot: ReviewInputSnapshot): {
  body: ReadableStream<Uint8Array>;
  bytes: number;
} {
  // Framed v1: uint32 JSON metadata length, metadata, then raw UTF-8 source frames.
  // Avoid escaping and re-serializing up to six large source strings into JSON.
  const encoder = new TextEncoder();
  const sources: Uint8Array[] = [];
  const metadata = {
    ...snapshot,
    files: snapshot.files.map(({ context, ...file }) => {
      if (!context) return file;
      const bytes = encoder.encode(context.text);
      sources.push(bytes);
      return {
        ...file,
        context: {
          repository: context.repository,
          sha: context.sha,
          path: context.path,
          bytes: bytes.byteLength,
        },
      };
    }),
  };
  const json = encoder.encode(JSON.stringify(metadata));
  const bytes =
    4 + json.byteLength + sources.reduce((sum, b) => sum + b.byteLength, 0);
  if (bytes > LIMITS.snapshotBytes)
    throw new ReviewError(
      'SNAPSHOT_BYTE_LIMIT',
      'Review input exceeds the bounded snapshot response limit.',
      413,
    );
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, json.byteLength);
  return {
    bytes,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(header);
        controller.enqueue(json);
        for (const source of sources) controller.enqueue(source);
        controller.close();
      },
    }),
  };
}
