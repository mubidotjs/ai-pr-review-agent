// Isolated operator experiment. Never imported by the PRISM application.
export const PROBE_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const PROBE_PROMPT = 'Reply with exactly PRISM_PROBE_OK.';
export const PROBE_INPUT = {
  messages: [{ role: 'user', content: PROBE_PROMPT }],
  max_completion_tokens: 32,
  chat_template_kwargs: { enable_thinking: false },
  stream: false,
  n: 1,
} as const;
export interface ProbeAi {
  run(
    model: string,
    input: typeof PROBE_INPUT,
    options: { returnRawResponse: true; signal: AbortSignal },
  ): Promise<Response>;
  lastRequestId?: string | null;
}
export interface ProbeEnvironment {
  AI?: ProbeAi;
  PROBE_SECRET?: string;
  PROBE_EXPIRES?: string;
}
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Prism-Probe': 'm3-v1',
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers });
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const count = (value: unknown) =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1000000
    ? value
    : undefined;
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z\d._:/@-]{1,160}$/.test(value)
    ? value
    : undefined;

export async function probeBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0,
    text = '';
  try {
    while (true) {
      if (signal.aborted) throw new Error('Read aborted');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('Read aborted');
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new Error('Bounded response exceeded');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
}

export function summarizeProbeResponse(value: unknown) {
  const root = object(value);
  const choice =
    root && Array.isArray(root.choices) && root.choices.length === 1
      ? object(root.choices[0])
      : null;
  const message = object(choice?.message);
  const content = message?.content;
  const usage = object(root?.usage);
  const detail = object(usage?.completion_tokens_details);
  const promptTokens = count(usage?.prompt_tokens),
    completionTokens = count(usage?.completion_tokens),
    reasoningTokens = count(detail?.reasoning_tokens);
  const validShape =
    root?.object === 'chat.completion' &&
    message?.role === 'assistant' &&
    typeof content === 'string' &&
    new TextEncoder().encode(content).byteLength <= 2048 &&
    !message.tool_calls;
  const capsViolated =
    (promptTokens !== undefined && promptTokens > 256) ||
    (completionTokens !== undefined && completionTokens > 32) ||
    (reasoningTokens !== undefined && reasoningTokens > 0);
  return {
    shape: validShape
      ? 'chat.completion/choices[0].message.content'
      : 'unrecognized-or-incomplete',
    nonempty: validShape && content.trim().length > 0,
    output: validShape ? content : undefined,
    finishReason: ['stop', 'length', 'content_filter'].includes(
      String(choice?.finish_reason),
    )
      ? choice?.finish_reason
      : undefined,
    responseId: identifier(root?.id),
    returnedModel: identifier(root?.model),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: count(usage?.total_tokens),
      reasoningTokens,
    },
    capsViolated,
  };
}

export function createProviderProbe(timeoutMs = 18000) {
  let consumed = false;
  return {
    async fetch(request: Request, env: ProbeEnvironment): Promise<Response> {
      const expiry = Number(env.PROBE_EXPIRES);
      if (
        !env.PROBE_SECRET ||
        env.PROBE_SECRET.length < 64 ||
        request.headers.get('Authorization') !== `Bearer ${env.PROBE_SECRET}`
      )
        return json({ error: 'UNAUTHORIZED' }, 401);
      if (!Number.isSafeInteger(expiry) || expiry <= Date.now())
        return json({ error: 'DISABLED_OR_EXPIRED' }, 410);
      const url = new URL(request.url);
      if (
        url.pathname !== '/api/provider-probe' ||
        url.search ||
        request.headers.has('Origin')
      )
        return json({ error: 'REJECTED_ROUTE' }, 404);
      if (request.method !== 'POST')
        return json(
          {
            error: 'METHOD_NOT_ALLOWED',
            bindingConfigured: typeof env.AI?.run === 'function',
          },
          405,
        );
      if (consumed) return json({ error: 'ALREADY_CONSUMED' }, 410);
      if (
        !/^application\/json(?:;|$)/i.test(
          request.headers.get('Content-Type') ?? '',
        )
      )
        return json({ error: 'INVALID_REQUEST' }, 415);
      try {
        const body = await probeBoundedText(
          request.body,
          2,
          AbortSignal.timeout(3000),
        );
        if (body !== '{}') return json({ error: 'INVALID_REQUEST' }, 400);
      } catch {
        return json({ error: 'INVALID_REQUEST' }, 400);
      }
      if (!env.AI || typeof env.AI.run !== 'function')
        return json(
          { error: 'BINDING_UNAVAILABLE', bindingInvocations: 0 },
          503,
        );
      if (consumed) return json({ error: 'ALREADY_CONSUMED' }, 410);
      // Synchronous latch before the only AI.run. Global protection additionally
      // comes from one operator dispatch, an in-memory secret and route removal.
      consumed = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await env.AI.run(PROBE_MODEL, PROBE_INPUT, {
          returnRawResponse: true,
          signal: controller.signal,
        });
        const providerStatus = response.status;
        const providerRequestId = identifier(
          response.headers.get('cf-ai-req-id') ?? env.AI.lastRequestId,
        );
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            await probeBoundedText(response.body, 16384, controller.signal),
          );
        } catch {
          return json({
            bindingInvocations: 1,
            bindingReturned: true,
            providerStatus,
            providerRequestId,
            category: controller.signal.aborted
              ? 'PROVIDER_TIMEOUT'
              : 'BOUNDED_OR_INVALID_RESPONSE',
          });
        }
        if (!response.ok) {
          const error = object(parsed);
          const errors = Array.isArray(error?.errors)
            ? object(error.errors[0])
            : null;
          return json({
            bindingInvocations: 1,
            bindingReturned: true,
            providerStatus,
            providerRequestId,
            internalCode: count(error?.internalCode ?? errors?.code),
            category:
              providerStatus === 429
                ? 'RATE_OR_QUOTA_LIMIT'
                : [401, 403].includes(providerStatus)
                  ? 'AUTHORIZATION'
                  : providerStatus === 400
                    ? 'REQUEST_CONTRACT'
                    : providerStatus === 404
                      ? 'MODEL_UNAVAILABLE'
                      : 'PROVIDER_HTTP_ERROR',
          });
        }
        const result = summarizeProbeResponse(parsed);
        return json({
          bindingInvocations: 1,
          bindingReturned: true,
          providerStatus,
          providerRequestId,
          model: PROBE_MODEL,
          ...result,
          category: result.capsViolated
            ? 'CAP_CONTRACT_VIOLATION'
            : result.nonempty
              ? 'NONEMPTY_MODEL_RESPONSE'
              : 'EMPTY_OR_UNRECOGNIZED_RESPONSE',
        });
      } catch {
        return json({
          bindingInvocations: 1,
          bindingReturned: false,
          providerRequestId: identifier(env.AI.lastRequestId),
          category: controller.signal.aborted
            ? 'PROVIDER_TIMEOUT'
            : 'BINDING_EXCEPTION',
        });
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
export default createProviderProbe();
