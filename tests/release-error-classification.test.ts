import { describe, expect, it } from 'vitest';
import { releaseFixture, post, SERVER_SECRET } from './release-fixtures';
import { createReleaseAgent } from '../src/server/release/agent-app';
import { createReleaseIngestion } from '../src/server/release/ingestion';
import { PrivateRelay } from '../src/server/release/relay';
import { WorkersAiAdapter } from '../src/server/agent/workers-ai';
import { runAgentReview } from '../src/server/agent/engine';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { localNodeRoute } from './node-http';
import type { AgentResult } from '../src/server/agent/result';
import { ReviewBudget } from '../src/release/cloudflare';
import { ReleaseError } from '../src/release/contract';

// Synthetic provider envelopes only. Never invokes a remote binding or GitHub.
const PRIVATE = 'PRIVATE_PROMPT_SOURCE_SECRET';
const decision = '{"type":"generate","findingIds":[]}';
function native(content = decision, message = {}, usage = {}) {
  let name = 'finish_review',
    args = content;
  try {
    const d = JSON.parse(content);
    if (d.type === 'tool') {
      name = d.call.name;
      args = JSON.stringify(d.call.arguments);
    } else if (d.type === 'generate')
      args = JSON.stringify({ findingIds: d.findingIds });
  } catch {
    /* invalid JSON remains invalid function arguments */
  }
  return Response.json({
    object: 'chat.completion',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'synthetic-call',
              type: 'function',
              function: { name, arguments: args },
            },
          ],
          ...message,
        },
      },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 100, ...usage },
  });
}
async function setup() {
  const f = releaseFixture();
  const ingestion = createReleaseIngestion(f.config, fixtureTransport());
  const login = await ingestion(
    post('/api/session', { code: f.config.accessCode }),
  );
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const agent = createReleaseAgent(f.config, { transport: fixtureTransport() });
  return { ...f, cookie, agent };
}
async function review(f: Awaited<ReturnType<typeof setup>>) {
  return (
    await (await f.agent(post('/api/agent', { url: PR_URL }, f.cookie))).json()
  ).result as AgentResult;
}

describe('safe native → relay → adapter → engine error provenance', () => {
  it.each([
    ['invalid decision JSON', () => native(PRIVATE), 'MODEL_JSON_INVALID'],
    [
      'Markdown-wrapped JSON',
      () => native('```json\n' + decision + '\n```'),
      'MODEL_JSON_INVALID',
    ],
    [
      'unsupported tool arguments',
      () =>
        native(
          JSON.stringify({
            type: 'tool',
            call: {
              name: 'listChangedFiles',
              arguments: { offset: 0, count: 100 },
            },
          }),
        ),
      'MODEL_SCHEMA_INVALID',
    ],
    [
      'unsupported native action',
      () =>
        native(
          JSON.stringify({
            type: 'tool',
            call: { name: 'postReview', arguments: {} },
          }),
        ),
      'MODEL_ACTION_UNSUPPORTED',
    ],
    [
      'oversized native arguments',
      () => native('x'.repeat(32769)),
      'MODEL_OUTPUT_LIMIT',
    ],
    [
      'completion truncated at the cap',
      () =>
        Response.json({
          object: 'chat.completion',
          choices: [{ finish_reason: 'length', message: { content: PRIVATE } }],
        }),
      'PROVIDER_TOKEN_BOUND',
    ],
    [
      'prompt-token bound',
      () => native(decision, {}, { prompt_tokens: 1000000 }),
      'PROVIDER_TOKEN_BOUND',
    ],
    [
      'completion-token bound',
      () => native(decision, {}, { completion_tokens: 2049 }),
      'PROVIDER_TOKEN_BOUND',
    ],
    [
      'unexpected reasoning tokens',
      () =>
        native(
          decision,
          {},
          { completion_tokens_details: { reasoning_tokens: 1 } },
        ),
      'PROVIDER_TOKEN_BOUND',
    ],
    [
      'non-JSON provider envelope',
      () => new Response(PRIVATE),
      'PROVIDER_SHAPE',
    ],
    [
      'unrecognized envelope',
      () => Response.json({ response: PRIVATE }),
      'PROVIDER_SHAPE',
    ],
    [
      'nonempty native tool calls',
      () => native(decision, { tool_calls: [{ function: { name: PRIVATE } }] }),
      'PROVIDER_SHAPE',
    ],
    [
      'nonempty legacy function call',
      () => native(decision, { function_call: { name: PRIVATE } }),
      'PROVIDER_SHAPE',
    ],
    [
      'provider refusal',
      () => native(decision, { refusal: PRIVATE }),
      'PROVIDER_SHAPE',
    ],
    [
      'HTTP provider failure',
      () => Response.json({ message: PRIVATE }, { status: 503 }),
      'PROVIDER_ERROR',
    ],
    [
      'HTTP provider quota',
      () => Response.json({ message: PRIVATE }, { status: 429 }),
      'PROVIDER_QUOTA',
    ],
  ] as const)(
    'retains %s classification without provider payloads or retry',
    async (_name, response, code) => {
      const f = await setup();
      f.run.mockImplementationOnce(async () => response());
      const result = await review(f);
      expect(result.status).toBe('failed');
      expect(result.rejected).toContainEqual(
        code === 'PROVIDER_SHAPE'
          ? { code, diagnostic: expect.objectContaining({ version: 1 }) }
          : { code },
      );
      expect(result.ai).toMatchObject({
        attempts: 1,
        responses: 0,
        realInference: false,
      });
      expect(result.findings).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      expect(f.run).toHaveBeenCalledTimes(1);
      const counters = await f.relay.call<{
        calls: number;
        reservedNeurons: number;
      }>('/status', {});
      expect(counters.calls).toBe(1);
      expect(counters.reservedNeurons).toBeGreaterThan(50);
      // Failed native outcomes retain reservations/lease and cannot produce an approval draft.
      expect(
        (
          await f.agent(
            post(
              '/api/agent/approve',
              {
                actor: 'human',
                confirm: true,
                runId: result.runId,
                digest: 'a'.repeat(64),
                selectedIndexes: [0],
              },
              f.cookie,
            ),
          )
        ).status,
      ).toBe(410);
    },
  );

  it.each(['Error', 'TimeoutError'] as const)(
    'classifies thrown binding %s using only its safe category',
    async (name) => {
      const f = await setup();
      const error = new Error(PRIVATE);
      error.name = name;
      f.run.mockRejectedValueOnce(error);
      const result = await review(f);
      expect(result.rejected).toContainEqual({
        code: name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
      });
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      expect(f.run).toHaveBeenCalledTimes(1);
    },
  );

  it('reports a non-Response binding return as a response contract mismatch, not provider failure', async () => {
    const f = await setup();
    f.run.mockResolvedValueOnce({ response: PRIVATE } as never);
    const result = await review(f);
    expect(result.rejected).toEqual([
      {
        code: 'PROVIDER_SHAPE',
        diagnostic: {
          version: 1,
          stage: 'return',
          field: 'return',
          issue: 'type',
          received: 'object',
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it.each(['system', 'tools', 'allowedTools'] as const)(
    'reports a %s contract failure before native dispatch',
    async (field) => {
      const f = await setup();
      const original = f.transport.getMockImplementation()!;
      f.transport.mockImplementation(async (input, init) => {
        if (new URL(String(input)).pathname === '/decide') {
          const body = JSON.parse(String(init?.body));
          if (field === 'system') body.request.system = PRIVATE;
          else if (field === 'tools') body.request.tools[0].contract = PRIVATE;
          else body.request.allowedTools = [PRIVATE];
          return original(input, { ...init, body: JSON.stringify(body) });
        }
        return original(input, init);
      });
      const result = await review(f);
      expect(result.rejected).toContainEqual({ code: 'INVALID_CONTRACT' });
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      expect(result.findings).toEqual([]);
      expect(f.run).not.toHaveBeenCalled();
      expect(await f.relay.call('/status', {})).toMatchObject({
        calls: 0,
        reservedNeurons: 0,
      });
    },
  );

  it.each([undefined, null, []])(
    'refuses an absent/null/empty required native tool collection (%j)',
    async (tool_calls) => {
      const f = await setup();
      f.run.mockResolvedValueOnce(
        native(decision, { tool_calls, function_call: null, refusal: null }),
      );
      const result = await review(f);
      expect(result.ai).toMatchObject({
        attempts: 1,
        responses: 0,
        realInference: false,
      });
      expect(result.rejected).toEqual([
        {
          code: 'PROVIDER_SHAPE',
          diagnostic: expect.objectContaining({
            stage: 'field',
            field: 'message.tool_calls',
            issue:
              tool_calls === undefined
                ? 'missing'
                : Array.isArray(tool_calls)
                  ? 'count'
                  : 'type',
          }),
        },
      ]);
      expect(result.findings).toEqual([]); // Empty proposals never become safety clearance.
      expect(f.run).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps backend evidence validation with nullable native assistant auxiliary fields', async () => {
    const f = await setup(),
      original = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (...args) => {
      const body = await (await original(...args)).json();
      body.choices[0].message.content = null;
      body.choices[0].message.refusal = null;
      body.choices[0].finish_reason = 'stop';
      body.choices[0].message.tool_calls[0].index = 0;
      return Response.json(body);
    });
    const result = await review(f);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'nan-comparison',
      path: 'src/checkout/validate.ts',
      line: 2,
      evidenceValidation: 'backend-pinned-supported-predicate',
    });
    expect(result.ai).toMatchObject({ attempts: 3, responses: 3 });
    expect(f.run).toHaveBeenCalledTimes(3);
  });

  it('preserves invalid-decision classification through the actual local Node HTTP route', async () => {
    const f = await setup();
    f.run.mockResolvedValueOnce(native(PRIVATE));
    const route = await localNodeRoute(f.agent);
    try {
      const response = await fetch(route.origin + '/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: f.cookie },
        body: JSON.stringify({ url: PR_URL }),
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.text();
      expect(JSON.parse(body).result.rejected).toEqual([
        { code: 'MODEL_JSON_INVALID' },
      ]);
      expect(body).not.toContain(PRIVATE);
      expect(f.run).toHaveBeenCalledTimes(1);
    } finally {
      await route.close();
    }
  });
});

describe('private relay failures are not misattributed to the model/provider', () => {
  it.each(['Error', 'TimeoutError'] as const)(
    'classifies Node relay transport %s without retaining exception details',
    async (name) => {
      const error = new Error(PRIVATE);
      error.name = name;
      const relay = new PrivateRelay(
        'https://test.workers.dev',
        SERVER_SECRET,
        async () => {
          throw error;
        },
      );
      const { result } = await runAgentReview(
        { url: PR_URL },
        {
          model: new WorkersAiAdapter(relay, crypto.randomUUID()),
          allowRealModel: true,
          transport: fixtureTransport(),
        },
      );
      expect(result.rejected).toEqual([
        {
          code:
            name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'RELAY_UNAVAILABLE',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
    },
  );

  it.each([new Error(PRIVATE), new ReleaseError(PRIVATE)])(
    'sanitizes unexpected coordinator errors at the producer',
    async (error) => {
      const worker = new ReviewBudget(
        {
          storage: {
            get: async () => {
              throw error;
            },
            put: async () => {},
          },
        },
        { RELAY_SECRET: SERVER_SECRET } as never,
      );
      const response = await worker.fetch(
        new Request('https://test.workers.dev/status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SERVER_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: 'RELAY_UNAVAILABLE' },
      });
    },
  );
  it.each([
    [
      'unknown uppercase code',
      () =>
        Response.json(
          { error: { code: PRIVATE, message: PRIVATE } },
          { status: 502 },
        ),
      'RELAY_UNAVAILABLE',
    ],
    [
      'non-JSON gateway error',
      () => new Response(PRIVATE, { status: 502 }),
      'RELAY_UNAVAILABLE',
    ],
    [
      'malformed successful relay body',
      () => new Response(PRIVATE),
      'RELAY_RESPONSE_INVALID',
    ],
    [
      'invalid successful relay envelope',
      () => Response.json({ decision: PRIVATE, bindingResponse: true }),
      'RELAY_RESPONSE_INVALID',
    ],
  ] as const)(
    'sanitizes %s at the engine boundary',
    async (_name, response, code) => {
      let calls = 0;
      const relay = new PrivateRelay(
        'https://test.workers.dev',
        SERVER_SECRET,
        async () => {
          calls++;
          return response();
        },
      );
      const { result } = await runAgentReview(
        { url: PR_URL },
        {
          model: new WorkersAiAdapter(relay, crypto.randomUUID()),
          allowRealModel: true,
          transport: fixtureTransport(),
        },
      );
      expect(result.rejected).toEqual([{ code }]);
      expect(result.findings).toEqual([]);
      expect(result.ai).toMatchObject({
        attempts: 1,
        responses: 0,
        realInference: false,
      });
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      expect(calls).toBe(1);
    },
  );

  it('keeps caller cancellation distinct from a provider error', async () => {
    const abort = new AbortController();
    const relay = new PrivateRelay(
      'https://test.workers.dev',
      SERVER_SECRET,
      async () => {
        abort.abort();
        throw new Error(PRIVATE);
      },
    );
    const adapter = new WorkersAiAdapter(relay, crypto.randomUUID());
    await expect(adapter.next({} as never, abort.signal)).rejects.toMatchObject(
      { code: 'CANCELLED' },
    );
    expect(adapter.diagnostics()).toEqual({ attempts: 1, responses: 0 });
  });
});
