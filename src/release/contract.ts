/** Shared transport bounds. No provider credentials or repository content persist here. */
export const RELEASE = {
  model: '@cf/google/gemma-4-26b-a4b-it',
  completionTokens: 2048,
  inputBytes: 48 * 1024,
  outputBytes: 32 * 1024,
  relayBytes: 640 * 1024,
  modelTimeoutMs: 18000,
  reviewMs: 30000,
  reviewsPerHour: 4,
  callsPerDay: 64,
  neuronsPerDay: 2000,
  draftMs: 5 * 60 * 1000,
} as const;
export const safeJson = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
export class ReleaseError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
  }
}
export async function interrupted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort: () => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    abort = () => reject(new ReleaseError('PROVIDER_TIMEOUT', 504));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, failure]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
export async function readJson(
  request: Request | Response,
  limit: number,
  signal = AbortSignal.timeout(3000),
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ReleaseError('INVALID_BODY', 400);
  let text = '',
    bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new ReleaseError('TIMEOUT', 504);
      const chunk = await reader.read();
      if (signal.aborted) throw new ReleaseError('TIMEOUT', 504);
      if (chunk.done) return JSON.parse(text + decoder.decode());
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new ReleaseError('BODY_LIMIT', 413);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError('INVALID_BODY', 400);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
  }
}
// Published Gemma pricing: 9,091 / 27,273 Neurons per million input/output tokens.
// UTF-8 byte count + 1,024 template tokens is a conservative estimate, NOT a provider quota.
export const neuronEstimate = (inputTokens: number, outputTokens: number) =>
  Math.ceil(((inputTokens * 9091 + outputTokens * 27273) / 1000000) * 1000) /
  1000;
