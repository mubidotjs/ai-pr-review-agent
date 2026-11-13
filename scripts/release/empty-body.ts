import { boundedText } from '../../src/shared/io';

/** Check actual bytes; a proxy may remove Content-Length or use chunked framing. */
export async function isEmptyRequest(request: Request): Promise<boolean> {
  try {
    await boundedText(new Response(request.body), 0, undefined, request.signal);
    return true;
  } catch {
    return false;
  }
}
