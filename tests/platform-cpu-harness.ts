import { createApp } from '../src/server/index';
import {
  CPU_CASES,
  cpuFixtureTransport,
  type CpuCase,
} from './platform-cpu-fixtures';

interface ProbeEnv {
  CPU_PROBE_SECRET?: string;
  CPU_PROBE_EXPIRES?: string;
}
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function createCpuHarness() {
  const apps = new Map(
    CPU_CASES.map((name) => [name, createApp(cpuFixtureTransport(name))]),
  );
  let requests = 0;
  let isolate: string | undefined;
  return {
    async fetch(request: Request, env: ProbeEnv) {
      const secret = env.CPU_PROBE_SECRET;
      const expires = Number(env.CPU_PROBE_EXPIRES);
      // No secret means no callable test, including on the initial deployment.
      if (
        !secret ||
        secret.length < 32 ||
        request.headers.get('Authorization') !== `Bearer ${secret}`
      )
        return new Response(null, { status: 401, headers });
      if (!Number.isSafeInteger(expires) || expires <= Date.now())
        return new Response(null, { status: 410, headers });
      const url = new URL(request.url);
      const name = request.headers.get('X-Prism-Cpu-Case') as CpuCase;
      if (
        request.method !== 'POST' ||
        url.pathname !== '/api/review' ||
        url.search ||
        !apps.has(name)
      )
        return new Response(null, { status: 404, headers });
      if (++requests > 200) return new Response(null, { status: 429, headers });
      const cold = isolate === undefined;
      isolate ??= crypto.randomUUID();
      const started = Date.now();
      const response = await apps.get(name)!.fetch(request);
      // Safe correlation only; never log headers, bodies, sources or exceptions.
      response.headers.set('X-Prism-Cpu-Isolate', isolate);
      response.headers.set('X-Prism-Cpu-First-Request', String(cold));
      response.headers.set('X-Prism-Cpu-Case', name);
      response.headers.set('X-Prism-Cpu-Started', String(started));
      return response;
    },
  };
}
export default createCpuHarness();
