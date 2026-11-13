import { ReviewError } from './errors';

export async function boundedText(
  response: Response,
  max: number,
  onChunk?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted)
    throw new ReviewError(
      'TIME_LIMIT',
      'Reading was cancelled before it started.',
      504,
    );
  if (!response.body) return '';
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted)
        throw new ReviewError(
          'TIME_LIMIT',
          'Reading the response body was cancelled or timed out.',
          504,
        );
      if (done) break;
      size += value.byteLength;
      onChunk?.(value.byteLength);
      if (size > max)
        throw new ReviewError(
          'BYTE_LIMIT',
          'Response exceeds the bounded byte limit.',
          413,
        );
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
