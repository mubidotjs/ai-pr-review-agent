import { describe, expect, it, vi } from 'vitest';
import { readNativeResponse } from '../src/release/native-response';
import { ReleaseError } from '../src/release/contract';
import { safeProviderDiagnostic } from '../src/release/provider-diagnostics';

const PRIVATE = 'PRIVATE_MODEL_PROMPT_SOURCE_CREDENTIAL';
const envelope = () => ({
  id: 'synthetic-completion',
  object: 'chat.completion',
  created: 0,
  model: '@cf/google/gemma-4-26b-a4b-it',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      logprobs: null,
      message: {
        role: 'assistant',
        content: null as string | null,
        refusal: null,
        tool_calls: [
          {
            id: 'synthetic-call',
            type: 'function',
            function: { name: 'finish_review', arguments: '{"findingIds":[]}' },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});
const message = (patch: Record<string, unknown>) => {
  const v = envelope();
  return {
    ...v,
    choices: [
      { ...v.choices[0], message: { ...v.choices[0].message, ...patch } },
    ],
  };
};
const call = (patch: Record<string, unknown>) =>
  message({
    tool_calls: [{ ...envelope().choices[0].message.tool_calls[0], ...patch }],
  });
const fn = (patch: Record<string, unknown>) =>
  call({
    function: {
      ...envelope().choices[0].message.tool_calls[0].function,
      ...patch,
    },
  });
const usage = (patch: Record<string, unknown>) => ({
  ...envelope(),
  usage: { ...envelope().usage, ...patch },
});
const decode = (value: unknown, signal = new AbortController().signal) =>
  readNativeResponse(value, signal, 10000);

describe('documented native Gemma raw Response boundary (synthetic only)', () => {
  it.each([null, '', 'I will inspect the source. ' + PRIVATE])(
    'accepts and discards assistant content accompanying one native function (%j)',
    async (content) => {
      const normalized = await decode(
        Response.json(message({ content, refusal: null, function_call: null })),
      );
      expect(normalized).toEqual({
        name: 'finish_review',
        arguments: '{"findingIds":[]}',
        usage: { prompt: 100, completion: 20 },
      });
      expect(JSON.stringify(normalized)).not.toContain(PRIVATE);
    },
  );
  it('accepts documented absent usage without manufacturing measured token counts', async () => {
    const { usage: _usage, ...v } = envelope();
    void _usage;
    expect((await decode(Response.json(v))).usage).toBeUndefined();
  });
  it('accepts stop with one tool and JSON charset, ignoring non-authoritative metadata', async () => {
    const v = envelope();
    v.choices[0].finish_reason = 'stop';
    expect(
      await decode(
        new Response(JSON.stringify({ ...v, extra: PRIVATE }), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      ),
    ).toMatchObject({ name: 'finish_review' });
  });
  it.each([
    ['root scalar', (): unknown => PRIVATE, 'envelope', 'type'],
    ['root array', () => [], 'envelope', 'type'],
    [
      'REST wrapper',
      () => ({ success: true, result: envelope() }),
      'object',
      'missing',
    ],
    [
      'another model flat format',
      () => ({
        response: '',
        tool_calls: [{ name: 'finish_review', arguments: { findingIds: [] } }],
      }),
      'object',
      'missing',
    ],
    [
      'object tag',
      () => ({ ...envelope(), object: PRIVATE }),
      'object',
      'value',
    ],
    [
      'absent choices',
      () => ({ ...envelope(), choices: undefined }),
      'choices',
      'missing',
    ],
    [
      'choices type',
      () => ({ ...envelope(), choices: { toString: PRIVATE } }),
      'choices',
      'type',
    ],
    ['no choices', () => ({ ...envelope(), choices: [] }), 'choices', 'count'],
    [
      'multiple choices',
      () => ({
        ...envelope(),
        choices: [...envelope().choices, ...envelope().choices],
      }),
      'choices',
      'count',
    ],
    [
      'choice type',
      () => ({ ...envelope(), choices: [null] }),
      'choice',
      'type',
    ],
    [
      'finish reason',
      () => ({
        ...envelope(),
        choices: [
          { ...envelope().choices[0], finish_reason: { toString: PRIVATE } },
        ],
      }),
      'finish_reason',
      'value',
    ],
    [
      'message type',
      () => ({
        ...envelope(),
        choices: [{ ...envelope().choices[0], message: PRIVATE }],
      }),
      'message',
      'type',
    ],
    ['role', () => message({ role: PRIVATE }), 'message.role', 'value'],
    [
      'content type',
      () => message({ content: { text: PRIVATE } }),
      'message.content',
      'type',
    ],
    [
      'refusal',
      () => message({ refusal: PRIVATE }),
      'message.refusal',
      'value',
    ],
    [
      'reasoning',
      () => message({ reasoning_content: PRIVATE }),
      'message.reasoning_content',
      'value',
    ],
    [
      'legacy function call',
      () => message({ function_call: { name: PRIVATE } }),
      'message.function_call',
      'value',
    ],
    [
      'absent calls',
      () => message({ tool_calls: undefined }),
      'message.tool_calls',
      'missing',
    ],
    [
      'calls type',
      () => message({ tool_calls: PRIVATE }),
      'message.tool_calls',
      'type',
    ],
    [
      'no calls',
      () => message({ tool_calls: [] }),
      'message.tool_calls',
      'count',
    ],
    [
      'parallel calls',
      () =>
        message({
          tool_calls: [
            ...envelope().choices[0].message.tool_calls,
            ...envelope().choices[0].message.tool_calls,
          ],
        }),
      'message.tool_calls',
      'count',
    ],
    [
      'call type',
      () => message({ tool_calls: [PRIVATE] }),
      'tool_call',
      'type',
    ],
    [
      'call id missing',
      () => call({ id: undefined }),
      'tool_call.id',
      'missing',
    ],
    [
      'call id type',
      () => call({ id: { private: PRIVATE } }),
      'tool_call.id',
      'type',
    ],
    [
      'call id limit',
      () => call({ id: 'x'.repeat(257) }),
      'tool_call.id',
      'limit',
    ],
    ['custom call', () => call({ type: 'custom' }), 'tool_call.type', 'value'],
    [
      'function type',
      () => call({ function: PRIVATE }),
      'tool_call.function',
      'type',
    ],
    [
      'name type',
      () => fn({ name: { private: PRIVATE } }),
      'tool_call.function.name',
      'type',
    ],
    [
      'name bound',
      () => fn({ name: 'x'.repeat(65) }),
      'tool_call.function.name',
      'limit',
    ],
    [
      'object arguments',
      () => fn({ arguments: { findingIds: [] } }),
      'tool_call.function.arguments',
      'type',
    ],
    ['usage null', () => ({ ...envelope(), usage: null }), 'usage', 'type'],
    [
      'usage missing prompt',
      () => usage({ prompt_tokens: undefined }),
      'usage.prompt_tokens',
      'missing',
    ],
    [
      'usage prompt type',
      () => usage({ prompt_tokens: PRIVATE }),
      'usage.prompt_tokens',
      'type',
    ],
    [
      'usage completion value',
      () => usage({ completion_tokens: -1 }),
      'usage.completion_tokens',
      'value',
    ],
    [
      'usage details type',
      () => usage({ completion_tokens_details: null }),
      'usage.completion_tokens_details',
      'type',
    ],
    [
      'reasoning type',
      () => usage({ completion_tokens_details: { reasoning_tokens: PRIVATE } }),
      'usage.completion_tokens_details.reasoning_tokens',
      'type',
    ],
  ] as const)(
    'diagnoses %s without echoing provider values',
    async (_name, create, field, issue) => {
      const error = await decode(Response.json(create())).catch((e) => e);
      expect(error).toBeInstanceOf(ReleaseError);
      expect(error.code).toBe('PROVIDER_SHAPE');
      expect(error.diagnostic).toMatchObject({ version: 1, field, issue });
      expect(safeProviderDiagnostic(error.diagnostic)).toEqual(
        error.diagnostic,
      );
      expect(JSON.stringify(error.diagnostic)).not.toContain(PRIVATE);
      expect(JSON.stringify(error.diagnostic).length).toBeLessThan(256);
    },
  );
  it.each([undefined, null, PRIVATE, {}, new ReadableStream()])(
    'diagnoses the native return type without accepting a parsed object (%j)',
    async (value) => {
      const e = await decode(value).catch((e) => e);
      expect(e.diagnostic).toMatchObject({
        stage: 'return',
        field: 'return',
        issue: 'type',
      });
      expect(JSON.stringify(e.diagnostic)).not.toContain(PRIVATE);
    },
  );
  it.each([
    [
      'empty body',
      () =>
        new Response(null, { headers: { 'Content-Type': 'application/json' } }),
      'missing',
    ],
    ['media type', () => new Response(PRIVATE), 'media-type'],
    [
      'JSON',
      () =>
        new Response(PRIVATE, {
          headers: { 'Content-Type': 'application/json' },
        }),
      'invalid-json',
    ],
    [
      'UTF8',
      () =>
        new Response(new Uint8Array([0xc3, 0x28]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      'invalid-utf8',
    ],
    [
      'oversize',
      () =>
        new Response('x'.repeat(65537), {
          headers: { 'Content-Type': 'application/json' },
        }),
      'limit',
    ],
    [
      'read failure',
      () =>
        new Response(
          new ReadableStream({
            pull() {
              throw new Error(PRIVATE);
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      'read',
    ],
  ] as const)(
    'diagnoses body %s without retaining payloads',
    async (_name, create, issue) => {
      const e = await decode(create()).catch((e) => e);
      expect(e.diagnostic).toMatchObject({
        stage: 'body',
        field: 'body',
        issue,
        version: 1,
        httpStatus: 200,
      });
      expect(e.diagnostic.bodyBytes).toBeLessThanOrEqual(65537);
      expect(JSON.stringify(e)).not.toContain(PRIVATE);
    },
  );
  it('diagnoses an already consumed or locked response', async () => {
    const r = Response.json(envelope());
    await r.text();
    await expect(decode(r)).rejects.toMatchObject({
      diagnostic: { stage: 'body', issue: 'used' },
    });
    const locked = Response.json(envelope()),
      reader = locked.body!.getReader();
    try {
      await expect(decode(locked)).rejects.toMatchObject({
        diagnostic: { issue: 'used' },
      });
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
  it('cancels a pending read on timeout without retrying or classifying it as a shape error', async () => {
    const controller = new AbortController(),
      cancel = vi.fn();
    const r = new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    const pending = decode(r, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('cancels an oversized upstream stream at the bound', async () => {
    const cancel = vi.fn();
    const r = new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(65537));
        },
        cancel,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    await expect(decode(r)).rejects.toMatchObject({
      diagnostic: { issue: 'limit', bodyBytes: 65537 },
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...envelope(), choices: [{ finish_reason: 'length' }] },
    usage({ prompt_tokens: 10001 }),
    usage({ completion_tokens: 2049 }),
    usage({ completion_tokens_details: { reasoning_tokens: 1 } }),
  ])('keeps explicit token-bound violations terminal', async (v) => {
    await expect(decode(Response.json(v))).rejects.toMatchObject({
      code: 'PROVIDER_TOKEN_BOUND',
    });
  });
  it('keeps the argument byte limit even with valid surrounding prose', async () => {
    await expect(
      decode(Response.json(fn({ arguments: 'é'.repeat(16385) }))),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_LIMIT' });
  });
  it.each([429, 503])(
    'classifies HTTP %s without reading an exception body',
    async (status) => {
      const r = new Response(PRIVATE, { status });
      await expect(decode(r)).rejects.toMatchObject({
        code: status === 429 ? 'PROVIDER_QUOTA' : 'PROVIDER_ERROR',
        diagnostic: undefined,
      });
    },
  );
});
