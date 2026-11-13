import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  CPU_WORKER_NAME,
  permittedPlatformRequest,
} from './platform-cpu-metadata';
const exec = promisify(execFile);

// Official CLI credential flow; capture only in memory, never print or persist.
export async function platformApi() {
  const account = process.env.PRISM_CPU_ACCOUNT_ID;
  if (!account || !/^[a-f\d]{32}$/.test(account))
    throw new Error('Account ID required');
  const { stdout } = await exec(
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
    throw new Error('Official Wrangler authorization unavailable');
  });
  let auth: { type: string; token: string };
  try {
    auth = JSON.parse(stdout);
  } catch {
    throw new Error('Invalid official authorization output');
  }
  if (auth.type !== 'oauth' || typeof auth.token !== 'string')
    throw new Error('A scoped OAuth session is required');
  return {
    account,
    scriptPath: `/accounts/${account}/workers/scripts/${CPU_WORKER_NAME}`,
    async request(path: string, init: RequestInit = {}) {
      if (!permittedPlatformRequest(account, path, init.method ?? 'GET'))
        throw new Error('API boundary rejected');
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
        errors?: { code?: number; message?: string }[];
        data?: unknown;
      };
      // No request or response bodies are logged; errors are classified by code.
      return { status: response.status, ...result };
    },
  };
}
