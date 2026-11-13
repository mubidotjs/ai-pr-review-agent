import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { z } from 'zod';
import type { Relay } from './relay';
import { ReleaseError, readJson, safeJson } from '../../release/contract';
export interface AccessConfig {
  accessCode: string;
  sessionSecret: string;
  relay: Relay;
}
export const releaseFailure = (error: unknown) =>
  safeJson(
    {
      error: {
        code:
          error instanceof ReleaseError
            ? error.code
            : error instanceof z.ZodError
              ? 'INVALID_REQUEST'
              : 'UNAVAILABLE',
        message:
          error instanceof ReleaseError && error.status === 429
            ? 'Shared review or AI allowance exhausted. Retry manually later.'
            : error instanceof ReleaseError && error.status === 401
              ? 'Unlock live reviews with your private access code below. Sessions expire after 30 minutes.'
              : 'Request unavailable or refused safely. No automatic retry.',
      },
    },
    error instanceof ReleaseError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 503,
  );
export class ReleaseAccess {
  constructor(private config: AccessConfig) {
    if (config.accessCode.length < 32 || config.sessionSecret.length < 32)
      throw new Error('Server-only access and session secrets required.');
  }
  private sign(value: string) {
    return createHmac('sha256', this.config.sessionSecret)
      .update(value)
      .digest('hex');
  }
  private equal(a: string, b: string) {
    const left = Buffer.from(a),
      right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  principal(request: Request): string {
    const value = request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('prism_session='))
      ?.slice(14);
    const match = value?.match(/^([a-f0-9]{64})\.(\d{13})\.([a-f0-9]{64})$/);
    if (
      !match ||
      Number(match[2]) <= Date.now() ||
      Number(match[2]) > Date.now() + 30 * 60000 ||
      !this.equal(this.sign(`${match[1]}.${match[2]}`), match[3])
    )
      throw new ReleaseError('ACCESS_REQUIRED', 401);
    return createHash('sha256').update(match[1]).digest('hex');
  }
  async session(request: Request): Promise<Response> {
    if (request.method === 'DELETE')
      return safeJsonWithCookie(
        { authenticated: false },
        'prism_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0',
      );
    if (request.method === 'GET') {
      this.principal(request);
      return safeJson({
        authenticated: true,
        ai: 'workers-ai',
        quota: await this.config.relay.call('/status', {}, request.signal),
      });
    }
    if (request.method !== 'POST')
      throw new ReleaseError('METHOD_NOT_ALLOWED', 405);
    const body = z
      .object({ code: z.string().min(1).max(128) })
      .strict()
      .safeParse(await readJson(request, 2048, request.signal));
    if (!body.success) throw new ReleaseError('INVALID_BODY', 400);
    await this.config.relay.call('/login', {}, request.signal); // Shared counter before credential comparison.
    if (!this.equal(body.data.code, this.config.accessCode))
      throw new ReleaseError('ACCESS_REQUIRED', 401);
    const payload = `${randomBytes(32).toString('hex')}.${Date.now() + 30 * 60000}`;
    return safeJsonWithCookie(
      { authenticated: true, ai: 'workers-ai' },
      `prism_session=${payload}.${this.sign(payload)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=1800`,
    );
  }
}
function safeJsonWithCookie(value: unknown, cookie: string) {
  const response = safeJson(value);
  response.headers.set('Set-Cookie', cookie);
  return response;
}
export function guardRequest(request: Request) {
  const url = new URL(request.url);
  if (
    url.search ||
    (request.headers.get('Origin') &&
      request.headers.get('Origin') !== url.origin) ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new ReleaseError('ORIGIN_REJECTED', 403);
  if (
    request.method === 'POST' &&
    !/^application\/json(?:;|$)/i.test(
      request.headers.get('Content-Type') ?? '',
    )
  )
    throw new ReleaseError('CONTENT_TYPE', 415);
}
