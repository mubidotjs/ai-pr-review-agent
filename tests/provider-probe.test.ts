import { describe, expect, it, vi } from 'vitest';
import {
  createProviderProbe,
  PROBE_INPUT,
  PROBE_MODEL,
  summarizeProbeResponse,
} from './provider-probe-worker';

const secret = 'synthetic-only-'.repeat(6);
const env = () => ({
  PROBE_SECRET: secret,
  PROBE_EXPIRES: String(Date.now() + 60000),
  AI: {
    run: vi.fn().mockResolvedValue(
      Response.json(
        {
          id: 'chatcmpl-synthetic',
          object: 'chat.completion',
          model: PROBE_MODEL,
          choices: [
            {
              message: { role: 'assistant', content: 'PRISM_PROBE_OK.' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 30,
            completion_tokens: 7,
            total_tokens: 37,
            completion_tokens_details: { reasoning_tokens: 0 },
          },
        },
        { headers: { 'cf-ai-req-id': 'synthetic-request-id' } },
      ),
    ),
  },
});
const req = (body = '{}', auth = `Bearer ${secret}`) =>
  new Request('https://isolated.example/api/provider-probe', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body,
  });

describe('one native provider probe (mock binding only)', () => {
  it('fails closed and cannot accept arbitrary prompts or configuration', async () => {
    const probe = createProviderProbe(),
      e = env();
    expect((await probe.fetch(req(), {})).status).toBe(401);
    expect((await probe.fetch(req('{}', 'wrong'), e)).status).toBe(401);
    expect(
      (await probe.fetch(req(), { ...e, PROBE_EXPIRES: '0' })).status,
    ).toBe(410);
    for (const body of ['{"prompt":"arbitrary"}', '{ }', 'x'.repeat(2048)])
      expect((await probe.fetch(req(body), e)).status).toBe(400);
    const ready = await probe.fetch(
      new Request('https://isolated.example/api/provider-probe', {
        headers: { Authorization: `Bearer ${secret}` },
      }),
      e,
    );
    expect(ready.status).toBe(405);
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('makes exactly one binding invocation with fixed capped non-thinking content', async () => {
    const probe = createProviderProbe(),
      e = env();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden in tests'));
    try {
      const responses = await Promise.all([
        probe.fetch(req(), e),
        probe.fetch(req(), e),
      ]);
      expect(e.AI.run).toHaveBeenCalledTimes(1);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 410]);
      const result = await responses.find((r) => r.status === 200)!.json();
      expect(result.category).toBe('NONEMPTY_MODEL_RESPONSE');
      expect(result.output).toBe('PRISM_PROBE_OK.');
      const [model, input, options] = e.AI.run.mock.calls[0];
      expect(model).toBe(PROBE_MODEL);
      expect(input).toEqual(PROBE_INPUT);
      expect(input.max_completion_tokens).toBe(32);
      expect(input.chat_template_kwargs.enable_thinking).toBe(false);
      expect(input).not.toHaveProperty('tools');
      expect(input).not.toHaveProperty('response_format');
      expect(options.returnRawResponse).toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });
  it('records safe HTTP classification without arbitrary error payloads', async () => {
    const probe = createProviderProbe(),
      e = env();
    e.AI.run.mockResolvedValue(
      Response.json(
        {
          internalCode: 5028,
          description: 'secret credential arbitrary exception',
        },
        { status: 404 },
      ),
    );
    const text = await (await probe.fetch(req(), e)).text();
    expect(text).toContain('MODEL_UNAVAILABLE');
    expect(text).toContain('5028');
    expect(text).not.toContain('secret');
    expect((await probe.fetch(req(), e)).status).toBe(410);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
  });
  it('aborts on deadline and never retries binding failures', async () => {
    const probe = createProviderProbe(10),
      e = env();
    e.AI.run.mockImplementation(
      (_model, _input, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('arbitrary secret error')),
            { once: true },
          ),
        ),
    );
    const result = await (await probe.fetch(req(), e)).json();
    expect(result.category).toBe('PROVIDER_TIMEOUT');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect((await probe.fetch(req(), e)).status).toBe(410);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
  });
  it('bounds responses and rejects unexpected shape or violated caps', async () => {
    const probe = createProviderProbe(),
      e = env();
    e.AI.run.mockResolvedValue(new Response('x'.repeat(16385)));
    expect((await (await probe.fetch(req(), e)).json()).category).toBe(
      'BOUNDED_OR_INVALID_RESPONSE',
    );
    expect(summarizeProbeResponse({ response: 'legacy' }).nonempty).toBe(false);
    const value = {
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: {
        prompt_tokens: 257,
        completion_tokens: 33,
        completion_tokens_details: { reasoning_tokens: 1 },
      },
    };
    expect(summarizeProbeResponse(value).capsViolated).toBe(true);
    expect(
      JSON.stringify(
        summarizeProbeResponse({ ...value, secret: 'never persist' }),
      ),
    ).not.toContain('never persist');
  });
});
