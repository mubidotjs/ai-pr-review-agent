import { LIMITS, type ReviewInputSnapshot } from '../shared/types';
import { boundedText } from '../shared/io';
import { ReviewError } from '../shared/errors';
import { analyzeSnapshot } from '../analysis/review';
import { decodeSnapshotWire } from '../analysis/snapshot-wire';
import type { WorkerJob, WorkerReply } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerJob>) => void) | null;
  postMessage(message: WorkerReply): void;
};
const clock = () => performance.timeOrigin + performance.now();
let busy = false;
scope.postMessage({ kind: 'ready', at: clock() });
scope.onmessage = async ({ data }) => {
  const id = data?.id;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) return;
  if (busy) {
    scope.postMessage({
      kind: 'error',
      id,
      code: 'BUSY',
      message: 'One analysis per Worker at a time.',
    });
    return;
  }
  busy = true;
  const receivedAt = clock();
  let retryAt: number | undefined;
  try {
    let input: unknown;
    const decodeStart = performance.now();
    if (data.kind === 'url') {
      if (typeof data.url !== 'string' || data.url.length > 2048)
        throw new ReviewError(
          'INVALID_URL',
          'PR URL exceeds its bounded length.',
        );
      scope.postMessage({ kind: 'progress', id, stage: 'fetch' });
      // The only network capability: one fixed same-origin backend route. Never fetch PR-supplied URLs here.
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        LIMITS.durationMs + 2000,
      );
      try {
        const response = await fetch('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: data.url }),
          signal: controller.signal,
          cache: 'no-store',
          redirect: 'error',
        });
        const type = response.headers.get('Content-Type') ?? '';
        // Read in the Worker. The UI never parses or clones the full source snapshot.
        const body =
          response.ok && type === 'application/vnd.prism.review-input.v1'
            ? decodeSnapshotWire(
                await boundedBinary(response, controller.signal),
              )
            : JSON.parse(
                await boundedText(
                  response,
                  LIMITS.snapshotBytes,
                  undefined,
                  controller.signal,
                ),
              );
        if (!response.ok) {
          if (typeof body.error?.retryAt === 'number')
            retryAt = body.error.retryAt;
          throw new ReviewError(
            typeof body.error?.code === 'string'
              ? body.error.code.slice(0, 64)
              : 'INGESTION_FAILED',
            typeof body.error?.message === 'string'
              ? body.error.message.slice(0, 1024)
              : 'PR ingestion unavailable. Retry manually.',
          );
        }
        input = body;
      } finally {
        clearTimeout(timer);
      }
    } else if (data.kind === 'snapshot') {
      if (data.input instanceof ArrayBuffer) {
        if (data.input.byteLength > LIMITS.snapshotBytes)
          throw new ReviewError(
            'SNAPSHOT_BYTE_LIMIT',
            'Review input exceeds its byte limit.',
          );
        input = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(data.input),
        );
      } else input = data.input;
    } else
      throw new ReviewError('INVALID_JOB', 'Unsupported analysis request.');
    const decodeMs = performance.now() - decodeStart;
    scope.postMessage({ kind: 'progress', id, stage: 'analyze' });
    const analysisStartedAt = clock();
    const { review, markdown } = analyzeSnapshot(input);
    const analysisFinishedAt = clock();
    scope.postMessage({
      kind: 'result',
      id,
      review,
      markdown,
      timings: {
        receivedAt,
        analysisStartedAt,
        analysisFinishedAt,
        sentAt: clock(),
        decodeMs,
        analysisMs: analysisFinishedAt - analysisStartedAt,
      },
    });
    // No global snapshot, source, AST, finding, or report retention. Production owner terminates on completion.
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      id,
      code: error instanceof ReviewError ? error.code : 'WORKER_ERROR',
      message:
        error instanceof ReviewError
          ? error.message
          : 'Browser analysis failed safely. Retry manually or load the demo.',
      retryAt,
    });
  } finally {
    busy = false;
  }
};

// Keep the wire shape visible to type checking without exposing a file/network tool.
export type WorkerSnapshot = ReviewInputSnapshot;

async function boundedBinary(
  response: Response,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ReviewError('INVALID_SNAPSHOT', 'Snapshot body is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted)
        throw new ReviewError('TIME_LIMIT', 'Snapshot read cancelled.');
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.snapshotBytes)
        throw new ReviewError(
          'BYTE_LIMIT',
          'Response exceeds the bounded byte limit.',
        );
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
