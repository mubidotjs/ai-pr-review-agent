import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export const PROVIDER_WORKER = 'prism-m3-provider-probe-20261113';
export const UNRELATED_WORKERS = [
  'ai-release-notes-generator',
  'ai-invoice-receipt-processor',
] as const;
export function probeApiAllowed(account: string, path: string, method: string) {
  const root = `/accounts/${account}/workers`,
    script = `${root}/scripts/${PROVIDER_WORKER}`;
  if (path === script) return ['PUT', 'DELETE'].includes(method);
  if (path === `${script}/subdomain`) return method === 'POST';
  if (method !== 'GET') return false;
  if (
    [`${script}/settings`, `${root}/scripts`, `${root}/subdomain`].includes(
      path,
    )
  )
    return true;
  if (
    UNRELATED_WORKERS.some((name) =>
      [
        `${root}/scripts/${name}/settings`,
        `${root}/scripts/${name}/deployments`,
      ].includes(path),
    )
  )
    return true;
  return (
    path ===
      `/accounts/${account}/ai/models/search?search=gemma-4-26b-a4b-it&per_page=10` ||
    path ===
      `/accounts/${account}/ai/models/schema?model=%40cf%2Fgoogle%2Fgemma-4-26b-a4b-it`
  );
}
export async function providerProbeApi() {
  const account = process.env.PRISM_PROBE_ACCOUNT_ID;
  if (!account || !/^[a-f\d]{32}$/.test(account))
    throw new Error('Account required');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'auth', 'token', '--json'],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_LOG: 'error',
        WRANGLER_LOG_SANITIZE: 'true',
      },
      maxBuffer: 16384,
    },
  ).catch(() => {
    throw new Error('Official scoped authorization unavailable');
  });
  let auth: { type: string; token: string };
  try {
    auth = JSON.parse(stdout);
  } catch {
    throw new Error('Invalid official authorization output');
  }
  if (auth.type !== 'oauth' || typeof auth.token !== 'string')
    throw new Error('Scoped OAuth required');
  return {
    account,
    script: `/accounts/${account}/workers/scripts/${PROVIDER_WORKER}`,
    async request(path: string, init: RequestInit = {}) {
      if (!probeApiAllowed(account, path, init.method ?? 'GET'))
        throw new Error('Probe API boundary rejected');
      const response = await fetch(
        `https://api.cloudflare.com/client/v4${path}`,
        {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            Authorization: `Bearer ${auth.token}`,
          },
        },
      );
      const result = (await response.json()) as {
        success?: boolean;
        result?: unknown;
        errors?: { code: number }[];
      };
      return { ...result, status: response.status };
    },
  };
}
