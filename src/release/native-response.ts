import { RELEASE, ReleaseError, interrupted } from './contract';
import type { ProviderDiagnostic } from './provider-diagnostics';

const BODY_BYTES = 64 * 1024;
type Field = ProviderDiagnostic['field'];
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function kind(value: unknown): ProviderDiagnostic['received'] {
  if (value === null) return 'null';
  if (value instanceof Response) return 'response';
  if (value instanceof ReadableStream) return 'stream';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function shape(
  stage: ProviderDiagnostic['stage'],
  field: Field,
  issue: ProviderDiagnostic['issue'],
  value: unknown,
  metadata: Pick<ProviderDiagnostic, 'httpStatus' | 'bodyBytes'> = {},
): never {
  throw new ReleaseError('PROVIDER_SHAPE', 502, {
    version: 1,
    stage,
    field,
    issue,
    received: kind(value),
    ...metadata,
  });
}
function object(value: unknown, field: Field) {
  if (!record(value))
    shape('field', field, value === undefined ? 'missing' : 'type', value);
  return value;
}
function text(value: unknown, field: Field, min = 0, max = BODY_BYTES) {
  if (typeof value !== 'string')
    shape('field', field, value === undefined ? 'missing' : 'type', value);
  if (value.length < min) shape('field', field, 'value', value);
  if (value.length > max) shape('field', field, 'limit', value);
  return value;
}
function integer(value: unknown, field: Field) {
  if (typeof value !== 'number')
    shape('field', field, value === undefined ? 'missing' : 'type', value);
  if (!Number.isSafeInteger(value) || value < 0)
    shape('field', field, 'value', value);
  return value;
}
function single(value: unknown, field: Field) {
  if (!Array.isArray(value))
    shape('field', field, value === undefined ? 'missing' : 'type', value);
  if (value.length !== 1) shape('field', field, 'count', value);
  return value[0] as unknown;
}

async function body(response: Response, signal: AbortSignal): Promise<unknown> {
  const metadata = { httpStatus: response.status, bodyBytes: 0 };
  if (response.bodyUsed || response.body?.locked)
    shape('body', 'body', 'used', response, metadata);
  if (!response.body) shape('body', 'body', 'missing', null, metadata);
  if (
    response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase() !== 'application/json'
  ) {
    void response.body.cancel().catch(() => {});
    shape('body', 'body', 'media-type', response, metadata);
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let contents = '';
  try {
    for (;;) {
      if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await interrupted(reader.read(), signal);
      } catch {
        if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
        shape('body', 'body', 'read', response, metadata);
      }
      if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
      metadata.bodyBytes = Math.min(
        BODY_BYTES + 1,
        metadata.bodyBytes + (chunk.value?.byteLength ?? 0),
      );
      if (metadata.bodyBytes > BODY_BYTES)
        shape('body', 'body', 'limit', response, metadata);
      try {
        contents += decoder.decode(chunk.value, { stream: !chunk.done });
      } catch {
        shape('body', 'body', 'invalid-utf8', response, metadata);
      }
      if (chunk.done) break;
    }
    try {
      return JSON.parse(contents) as unknown;
    } catch {
      shape('body', 'body', 'invalid-json', response, metadata);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    try {
      reader.releaseLock();
    } catch {
      /* Pending read is cancelled; never retain response data. */
    }
  }
}

/** Native Gemma JSON, not a REST result wrapper or another model's flat tool format. */
export async function readNativeResponse(
  raw: unknown,
  signal: AbortSignal,
  inputBound: number,
) {
  if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
  if (!(raw instanceof Response)) shape('return', 'return', 'type', raw);
  if (!raw.ok) {
    void raw.body?.cancel().catch(() => {});
    throw new ReleaseError(
      raw.status === 429 ? 'PROVIDER_QUOTA' : 'PROVIDER_ERROR',
      502,
    );
  }
  const envelope = await body(raw, signal);
  if (!record(envelope)) shape('envelope', 'envelope', 'type', envelope);
  if (envelope.object !== 'chat.completion')
    shape(
      'envelope',
      'object',
      envelope.object === undefined ? 'missing' : 'value',
      envelope.object,
    );
  const choice = object(single(envelope.choices, 'choices'), 'choice');
  if (choice.finish_reason === 'length')
    throw new ReleaseError('PROVIDER_TOKEN_BOUND', 502);
  if (
    typeof choice.finish_reason !== 'string' ||
    !['stop', 'tool_calls'].includes(choice.finish_reason)
  )
    shape(
      'field',
      'finish_reason',
      choice.finish_reason === undefined ? 'missing' : 'value',
      choice.finish_reason,
    );
  const message = object(choice.message, 'message');
  if (message.role !== 'assistant')
    shape(
      'field',
      'message.role',
      message.role === undefined ? 'missing' : 'value',
      message.role,
    );
  // Documented assistant prose may accompany a tool call. Discard it; it is never an action or finding.
  if (message.content != null) text(message.content, 'message.content');
  for (const field of ['refusal', 'reasoning_content'] as const) {
    if (
      message[field] != null &&
      text(message[field], `message.${field}`).length
    )
      shape('field', `message.${field}`, 'value', message[field]);
  }
  // Legacy function_call and multiple/custom calls are outside this workflow's requested contract.
  if (message.function_call != null)
    shape('field', 'message.function_call', 'value', message.function_call);
  const call = object(
    single(message.tool_calls, 'message.tool_calls'),
    'tool_call',
  );
  text(call.id, 'tool_call.id', 1, 256);
  if (call.type !== 'function')
    shape(
      'field',
      'tool_call.type',
      call.type === undefined ? 'missing' : 'value',
      call.type,
    );
  const fn = object(call.function, 'tool_call.function');
  const name = text(fn.name, 'tool_call.function.name', 1, 64);
  const args = text(fn.arguments, 'tool_call.function.arguments');
  let usage: { prompt: number; completion: number } | undefined;
  // Gemma's documented usage is optional. Absence retains the entire conservative reservation.
  // Present but malformed/over-bound usage is never treated as absence.
  if (envelope.usage !== undefined) {
    const value = object(envelope.usage, 'usage');
    const prompt = integer(value.prompt_tokens, 'usage.prompt_tokens');
    const completion = integer(
      value.completion_tokens,
      'usage.completion_tokens',
    );
    const details =
      value.completion_tokens_details === undefined
        ? undefined
        : object(
            value.completion_tokens_details,
            'usage.completion_tokens_details',
          );
    const reasoning =
      details?.reasoning_tokens === undefined
        ? 0
        : integer(
            details.reasoning_tokens,
            'usage.completion_tokens_details.reasoning_tokens',
          );
    if (
      prompt > inputBound ||
      completion > RELEASE.completionTokens ||
      reasoning > 0
    )
      throw new ReleaseError('PROVIDER_TOKEN_BOUND', 502);
    usage = { prompt, completion };
  }
  if (new TextEncoder().encode(args).length > RELEASE.outputBytes)
    throw new ReleaseError('MODEL_OUTPUT_LIMIT', 502);
  if (signal.aborted) throw new ReleaseError('PROVIDER_TIMEOUT', 502);
  return { name, arguments: args, usage };
}
