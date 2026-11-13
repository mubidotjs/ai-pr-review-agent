import { RELEASE, ReleaseError, readJson } from '../../release/contract';
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
    if (!/^\/(login|admit|decide|finish|draft|approve|status)$/.test(path))
      throw new ReleaseError('RELAY_ROUTE');
    const body = JSON.stringify(input);
    if (new TextEncoder().encode(body).length > RELEASE.relayBytes)
      throw new ReleaseError('BODY_LIMIT', 413);
    const timeout = AbortSignal.timeout(path === '/decide' ? 20000 : 3000);
    const response = await this.transport(this.origin + path, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const value = (await readJson(
      response,
      RELEASE.relayBytes,
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    )) as { error?: { code?: string } };
    if (!response.ok) {
      const code = value?.error?.code;
      throw new ReleaseError(
        typeof code === 'string' && /^[A-Z_]{1,60}$/.test(code)
          ? code
          : 'RELAY_UNAVAILABLE',
        response.status >= 400 && response.status <= 599
          ? response.status
          : 503,
      );
    }
    return value as T;
  }
}
