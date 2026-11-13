import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewRunner, type WorkerPort } from '../src/client/review-runner';
import type { WorkerJob, WorkerReply } from '../src/client/worker-protocol';
import { analyzeSnapshot } from '../src/analysis/review';
import { createDemoInput } from './fixtures';

class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  terminate = vi.fn();
  postMessage = vi.fn<(job: WorkerJob, transfer?: Transferable[]) => void>();
  send(data: WorkerReply) {
    this.onmessage?.({ data } as MessageEvent<WorkerReply>);
  }
  result() {
    const id = this.postMessage.mock.calls[0][0].id;
    this.send({
      kind: 'result',
      id,
      ...analyzeSnapshot(createDemoInput()),
      timings: {
        receivedAt: 0,
        analysisStartedAt: 0,
        analysisFinishedAt: 1,
        sentAt: 1,
        decodeMs: 0,
        analysisMs: 1,
      },
    });
  }
}
afterEach(() => vi.useRealTimers());
describe('browser Worker ownership', () => {
  it('terminates on cancellation and ignores stale callbacks after a replacement', async () => {
    const workers: FakeWorker[] = [];
    const runner = new ReviewRunner(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = runner.run('https://github.com/example/checkout/pull/42');
    const cancelled = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    });
    const oldHandler = workers[0].onmessage!;
    const second = runner.run(createDemoInput());
    await cancelled;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    oldHandler({
      data: { kind: 'error', id: 'review-1', code: 'STALE', message: 'stale' },
    } as MessageEvent<WorkerReply>);
    workers[1].result();
    expect((await second).review.findings).toHaveLength(3);
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });
  it('bounds analysis even when the worker cannot cooperatively process cancellation', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const runner = new ReviewRunner(() => worker);
    const result = runner.run(createDemoInput());
    worker.send({ kind: 'progress', id: 'review-1', stage: 'analyze' });
    const assertion = expect(result).rejects.toMatchObject({
      code: 'ANALYSIS_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('recovers from worker errors using a fresh worker', async () => {
    const workers: FakeWorker[] = [];
    const runner = new ReviewRunner(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = runner.run(createDemoInput());
    const failure = expect(first).rejects.toMatchObject({
      code: 'WORKER_ERROR',
    });
    workers[0].onerror?.({ preventDefault() {} } as ErrorEvent);
    await failure;
    const second = runner.run(createDemoInput());
    workers[1].result();
    expect((await second).markdown).toContain('no server attestation');
  });
  it('rejects message decoding errors and malformed replies', async () => {
    const worker = new FakeWorker();
    const runner = new ReviewRunner(() => worker);
    const result = runner.run(createDemoInput());
    const failure = expect(result).rejects.toMatchObject({
      code: 'WORKER_MESSAGE_ERROR',
    });
    worker.send(null as never);
    await failure;
  });
  it('rejects startup failure without analyzing on the main thread', async () => {
    const runner = new ReviewRunner(() => {
      throw new Error('unavailable');
    });
    await expect(runner.run(createDemoInput())).rejects.toMatchObject({
      code: 'WORKER_START_FAILED',
    });
  });
});
