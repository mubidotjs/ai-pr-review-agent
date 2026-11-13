import { LIMITS, type ReviewInputSnapshot } from '../shared/types';
import type { WorkerJob, WorkerReply } from './worker-protocol';

export type ResultReply = Extract<WorkerReply, { kind: 'result' }>;
export class BrowserReviewError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAt?: number,
  ) {
    super(message);
  }
}
export interface WorkerPort {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerJob, transfer?: Transferable[]): void;
  terminate(): void;
}
export class ReviewRunner {
  private sequence = 0;
  private active?: {
    id: string;
    worker: WorkerPort;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private factory: () => WorkerPort = () =>
      new Worker(new URL('./review.worker.ts', import.meta.url), {
        type: 'module',
        name: 'prism-review',
      }),
  ) {}
  cancel(): void {
    const job = this.active;
    if (!job) return;
    this.active = undefined;
    clearTimeout(job.timer);
    job.worker.terminate();
    job.reject(new DOMException('Review cancelled.', 'AbortError'));
  }
  run(input: string | ReviewInputSnapshot): Promise<ResultReply> {
    this.cancel();
    return new Promise((resolve, reject) => {
      let worker: WorkerPort;
      try {
        worker = this.factory();
      } catch {
        reject(
          new BrowserReviewError(
            'WORKER_START_FAILED',
            'Browser Web Worker unavailable. No main-thread analysis fallback.',
          ),
        );
        return;
      }
      const id = `review-${++this.sequence}`;
      const fail = (error: Error) => {
        if (this.active?.id !== id) return;
        const job = this.active;
        this.active = undefined;
        clearTimeout(job.timer);
        worker.terminate();
        reject(error);
      };
      const job = {
        id,
        worker,
        reject,
        timer: setTimeout(
          () =>
            fail(
              new BrowserReviewError(
                'WORKER_TIMEOUT',
                'Browser review exceeded its bounded duration. Retry manually.',
              ),
            ),
          LIMITS.durationMs + LIMITS.analysisMs + 5000,
        ),
      };
      this.active = job;
      worker.onerror = (event) => {
        event.preventDefault?.();
        fail(
          new BrowserReviewError(
            'WORKER_ERROR',
            'Browser Worker failed. Retry manually or load the demo.',
          ),
        );
      };
      worker.onmessageerror = () =>
        fail(
          new BrowserReviewError(
            'WORKER_MESSAGE_ERROR',
            'Browser Worker result could not be decoded.',
          ),
        );
      worker.onmessage = ({ data }) => {
        if (this.active !== job) return;
        if (
          !data ||
          typeof data !== 'object' ||
          !['ready', 'progress', 'result', 'error'].includes(data.kind)
        ) {
          fail(
            new BrowserReviewError(
              'WORKER_MESSAGE_ERROR',
              'Invalid browser Worker response.',
            ),
          );
          return;
        }
        if (this.active !== job || data.kind === 'ready' || data.id !== id)
          return;
        if (data.kind === 'progress' && data.stage === 'analyze') {
          clearTimeout(job.timer);
          job.timer = setTimeout(
            () =>
              fail(
                new BrowserReviewError(
                  'ANALYSIS_TIMEOUT',
                  'Browser analysis exceeded its 30-second budget.',
                ),
              ),
            LIMITS.analysisMs,
          );
        } else if (data.kind === 'error')
          fail(new BrowserReviewError(data.code, data.message, data.retryAt));
        else if (data.kind === 'result') {
          this.active = undefined;
          clearTimeout(job.timer);
          worker.terminate();
          resolve(data);
        }
      };
      try {
        if (typeof input === 'string')
          worker.postMessage({ kind: 'url', id, url: input });
        else {
          const buffer = new TextEncoder().encode(JSON.stringify(input)).buffer;
          if (buffer.byteLength > LIMITS.snapshotBytes)
            throw new BrowserReviewError(
              'SNAPSHOT_BYTE_LIMIT',
              'Demo snapshot exceeds its byte limit.',
            );
          worker.postMessage({ kind: 'snapshot', id, input: buffer }, [buffer]);
        }
      } catch {
        fail(
          new BrowserReviewError(
            'WORKER_MESSAGE_ERROR',
            'Browser Worker input could not be sent.',
          ),
        );
      }
    });
  }
}
