import {
  RELEASE,
  ReleaseError,
  readJson,
  interrupted,
} from '../../release/contract';
import { relayErrorCode } from '../../release/errors';
export interface Relay {
  call<T>(path: string, input: unknown, signal?: AbortSignal): Promise<T>;
}
export class PrivateRelay implements Relay {
  constructor(
    private origin: string,
    private secret: string,
    private transport: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.workers.dev') ||
      secret.length < 32
    )
      throw new Error(
        'Exact private workers.dev relay origin and server secret required.',
      );
  }
  async call<T>(
    path: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (
      !/^\/(login|admit|decide|propose|finish|draft|approve|status)$/.test(path)
    )
      throw new ReleaseError('RELAY_ROUTE');
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).length > RELEASE.relayBytes)
      throw new ReleaseError('BODY_LIMIT', 413);
    const timeout = AbortSignal.timeout(
      path === '/decide' || path === '/propose' ? 20000 : 3000,
    );
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await interrupted(
        this.transport(this.origin + path, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            Authorization: `Bearer ${this.secret}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: combined,
        }),
        combined,
      );
    } catch (error) {
      const timedOut =
        combined.aborted ||
        (error instanceof Error &&
          ['AbortError', 'TimeoutError'].includes(error.name));
      throw new ReleaseError(
        timedOut
          ? path === '/propose' && timeout.aborted && !signal?.aborted
            ? 'NODE_RELAY_DEADLINE'
            : 'TIMEOUT'
          : 'RELAY_UNAVAILABLE',
        timedOut ? 504 : 502,
      );
    }
    let value: unknown;
    try {
      value = await interrupted(
        readJson(response, RELEASE.relayBytes, combined),
        combined,
      );
    } catch {
      throw new ReleaseError(
        combined.aborted
          ? path === '/propose' && timeout.aborted && !signal?.aborted
            ? 'NODE_RELAY_DEADLINE'
            : 'TIMEOUT'
          : response.ok
            ? 'RELAY_RESPONSE_INVALID'
            : 'RELAY_UNAVAILABLE',
        combined.aborted ? 504 : 502,
      );
    }
    if (!response.ok) {
      const code =
        value &&
        typeof value === 'object' &&
        'error' in value &&
        value.error &&
        typeof value.error === 'object' &&
        'code' in value.error
          ? relayErrorCode(value.error.code)
          : undefined;
      throw new ReleaseError(
        code ?? 'RELAY_UNAVAILABLE',
        response.status >= 400 && response.status <= 599
          ? response.status
          : 503,
        code === 'PROVIDER_SHAPE' &&
          value &&
          typeof value === 'object' &&
          'error' in value &&
          value.error &&
          typeof value.error === 'object' &&
          'diagnostic' in value.error
          ? value.error.diagnostic
          : undefined,
      );
    }
    return value as T;
  }
}
