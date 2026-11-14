import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupProposalRelease as setup } from './proposal-release-fixture';
import { post } from './release-fixtures';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { runAgentReview } from '../src/server/agent/engine';
import { MockProposalModel } from '../src/server/agent/proposal-model';
function clocks() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('Deadline', 'TimeoutError')), ms);
    return c.signal;
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('safe owned timeout stages without raw provider data or retry', () => {
  it('distinguishes the native invocation deadline', async () => {
    clocks();
    const f = await setup();
    f.run.mockImplementationOnce(async () => new Promise(() => {}));
    const pending = f.agent(post('/api/agent', { url: PR_URL }, f.cookie));
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(18000);
    const { result } = await (await pending).json();
    expect(result.rejected).toEqual([{ code: 'NATIVE_INVOCATION_DEADLINE' }]);
    expect(result.findings).toEqual([]);
    expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('distinguishes response-body reading/validation from the invocation wait', async () => {
    clocks();
    const f = await setup(),
      pull = vi.fn(() => new Promise<void>(() => {}));
    f.run.mockResolvedValueOnce(
      new Response(new ReadableStream({ pull }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const pending = f.agent(post('/api/agent', { url: PR_URL }, f.cookie));
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(18000);
    const { result } = await (await pending).json();
    expect(result.rejected).toEqual([{ code: 'RESPONSE_VALIDATION_TIMEOUT' }]);
    expect(f.run).toHaveBeenCalledTimes(1);
  });
  it('distinguishes a Node relay deadline before any native dispatch', async () => {
    clocks();
    const f = await setup(),
      original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) =>
      new URL(String(input)).pathname === '/propose'
        ? new Promise(() => {})
        : original(input, init),
    );
    const pending = f.agent(post('/api/agent', { url: PR_URL }, f.cookie));
    await vi.waitFor(() =>
      expect(
        f.transport.mock.calls.some(([u]) => String(u).endsWith('/propose')),
      ).toBe(true),
    );
    await vi.advanceTimersByTimeAsync(20000);
    const { result } = await (await pending).json();
    expect(result.rejected).toEqual([{ code: 'NODE_RELAY_DEADLINE' }]);
    expect(f.run).not.toHaveBeenCalled();
  });
  it('distinguishes grant expiry during the native invocation', async () => {
    clocks();
    const f = await setup(),
      original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === '/propose') {
        const c = await f.storage.get<{
          grants: Record<string, { expires: number }>;
        }>('counters');
        for (const g of Object.values(c!.grants)) g.expires = Date.now() + 1000;
        await f.storage.put('counters', c);
      }
      return original(input, init);
    });
    f.run.mockImplementationOnce(async () => new Promise(() => {}));
    const pending = f.agent(post('/api/agent', { url: PR_URL }, f.cookie));
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    const { result } = await (await pending).json();
    expect(result.rejected).toEqual([{ code: 'REVIEW_GRANT_EXPIRED' }]);
    expect(result.findings).toEqual([]);
  });
  it('distinguishes the overall review deadline from a cancelled caller', async () => {
    clocks();
    const model = new MockProposalModel(async () => new Promise(() => {}));
    const pending = runAgentReview(
      { url: PR_URL },
      { model, transport: fixtureTransport(), limits: { durationMs: 100 } },
    );
    await vi.advanceTimersByTimeAsync(100);
    const { result } = await pending;
    expect(result.rejected).toContainEqual({ code: 'REVIEW_DEADLINE' });
    expect(result.findings).toEqual([]);
    const abort = new AbortController();
    const cancelled = runAgentReview(
      { url: PR_URL },
      { model, transport: fixtureTransport(), signal: abort.signal },
    );
    abort.abort();
    expect((await cancelled).result.status).toBe('cancelled');
  });
});
