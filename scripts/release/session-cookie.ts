import type { BrowserContext } from '@playwright/test';

/** Match the real API request path; root URL lookup excludes Path=/api cookies. */
export async function apiSessionCookie(
  context: Pick<BrowserContext, 'cookies'>,
  origin: string,
): Promise<string> {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:')
    throw new Error('SESSION_ORIGIN_INVALID');
  const cookies = await context.cookies(new URL('/api/agent', origin).href);
  const session = cookies.find((cookie) => cookie.name === 'prism_session');
  if (!session) throw new Error('SESSION_COOKIE_UNAVAILABLE');
  return session.value;
}
