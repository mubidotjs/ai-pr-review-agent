import type { Review, ReviewInputSnapshot } from '../shared/types';
export type WorkerJob =
  | { kind: 'url'; id: string; url: string }
  | { kind: 'snapshot'; id: string; input: ArrayBuffer | ReviewInputSnapshot };
export interface WorkerTimings {
  receivedAt: number;
  analysisStartedAt: number;
  analysisFinishedAt: number;
  sentAt: number;
  decodeMs: number;
  analysisMs: number;
}
export type WorkerReply =
  | { kind: 'ready'; at: number }
  | { kind: 'progress'; id: string; stage: 'fetch' | 'analyze' }
  | {
      kind: 'result';
      id: string;
      review: Review;
      markdown: string;
      timings: WorkerTimings;
    }
  | {
      kind: 'error';
      id: string;
      code: string;
      message: string;
      retryAt?: number;
    };
