import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { platformApi } from './platform-cpu-api';
import {
  CPU_WORKER_NAME,
  safeMetrics,
  type CpuMetric,
} from './platform-cpu-metadata';
import { CPU_CASES, type CpuCase } from '../tests/platform-cpu-fixtures';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import type { ReviewInputSnapshot } from '../src/shared/types';
import { PR_URL } from '../tests/upstream-fixtures';

// Explicitly invoked operator experiment, never imported by the app or CI.
if (process.env.PRISM_CPU_CONFIRMED_FREE !== 'true')
  throw new Error(
    'Verify the current Free plan in the account dashboard first',
  );
const api = await platformApi();
const script = api.scriptPath;
const exists = await api.request(`${script}/settings`);
if (exists.status !== 404)
  throw new Error('Refusing to overwrite an existing Worker');
const code = readFileSync('artifacts/cpu-deploy/platform-cpu-harness.js');
const secret = randomBytes(32).toString('hex');
const start = new Date().toISOString();
const runs: {
  scenario: CpuCase;
  clientStarted: string;
  clientWallMs: number;
  httpStatus: number;
  complete: boolean;
  responseBytes: number;
  serverStarted?: string;
  firstRequest?: boolean;
  isolate?: string;
  contextFiles?: number;
  inventoried?: number;
  upstreamRequests?: number;
  errorCode?: string;
}[] = [];
const report = {
  schemaVersion: 1,
  baseline: '2935065c2fe505eb9b5b74fde12fdfd69fc7b740',
  worker: CPU_WORKER_NAME,
  start,
  end: '',
  plan: 'Free (account dashboard verified)',
  sourceSha256: createHash('sha256').update(code).digest('hex'),
  platformCpuUnit: 'microseconds (GraphQL schema verified)',
  version: '',
  runs,
  metrics: [] as CpuMetric[],
  cleanup: { deleteStatus: 0, absenceStatus: 0 },
  failure: '',
};
let created = false;
try {
  const metadata = {
    main_module: 'platform-cpu-harness.js',
    compatibility_date: '2026-11-13',
    usage_model: 'standard',
    observability: { enabled: false },
    bindings: [
      { type: 'secret_text', name: 'CPU_PROBE_SECRET', text: secret },
      {
        type: 'plain_text',
        name: 'CPU_PROBE_EXPIRES',
        text: String(Date.now() + 3600000),
      },
    ],
  };
  const form = new FormData();
  form.set(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  form.set(
    'platform-cpu-harness.js',
    new Blob([code], { type: 'application/javascript+module' }),
    'platform-cpu-harness.js',
  );
  created = true; // Also clean up if an upload succeeds but its response is lost.
  const upload = await api.request(script, { method: 'PUT', body: form });
  if (!upload.success) throw new Error('Protected Worker upload failed');
  const uploaded = upload.result as {
    id?: string;
    deployment_id?: string;
    etag?: string;
  };
  report.version = uploaded.deployment_id ?? uploaded.etag ?? 'not returned';
  const subdomain = await api.request(
    `/accounts/${api.account}/workers/subdomain`,
  );
  const host = (subdomain.result as { subdomain?: string })?.subdomain;
  if (!host || !/^[a-z\d-]+$/.test(host))
    throw new Error('Invalid account subdomain');
  const enabled = await api.request(`${script}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  if (!enabled.success) throw new Error('Temporary route unavailable');
  const origin = `https://${CPU_WORKER_NAME}.${host}.workers.dev`;
  // First measured request is the full six-file/128 KiB case. One deployment;
  // isolate labels distinguish observed first requests from subsequent reuse.
  const order: CpuCase[] = [
    'large-6x128',
    ...CPU_CASES.filter((c) => c !== 'large-6x128'),
  ];
  for (const scenario of order) {
    let failed = 0;
    for (let i = 0; i < 8; i++) {
      const clientStarted = new Date().toISOString();
      const before = performance.now();
      const response = await fetch(`${origin}/api/review`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
          'X-Prism-Cpu-Case': scenario,
        },
        body: JSON.stringify({ url: PR_URL }),
      });
      const bytes = await response.arrayBuffer();
      const row: (typeof runs)[number] = {
        scenario,
        clientStarted,
        clientWallMs: performance.now() - before,
        httpStatus: response.status,
        complete: false,
        responseBytes: bytes.byteLength,
      };
      const timestamp = Number(response.headers.get('X-Prism-Cpu-Started'));
      if (timestamp > 0) row.serverStarted = new Date(timestamp).toISOString();
      row.firstRequest =
        response.headers.get('X-Prism-Cpu-First-Request') === 'true';
      const id = response.headers.get('X-Prism-Cpu-Isolate');
      if (id && /^[a-f\d-]{36}$/.test(id)) row.isolate = id;
      if (response.ok) {
        const input = decodeSnapshotWire(bytes) as ReviewInputSnapshot;
        row.complete = !!input.verification.after;
        row.contextFiles = input.files.filter((f) => f.context).length;
        row.inventoried = input.files.length;
        row.upstreamRequests = input.budget.requests;
        const expectedContexts =
          scenario === 'small-1'
            ? 1
            : scenario === 'small-4' || scenario === 'incomplete'
              ? 4
              : scenario === 'missing-source' || scenario === 'oversized-source'
                ? 5
                : 6;
        const expectedFiles =
          scenario === 'paginated-100'
            ? 100
            : scenario === 'small-1'
              ? 1
              : scenario === 'small-4'
                ? 4
                : 6;
        if (
          !row.complete ||
          input.budget.requests > 12 ||
          row.contextFiles !== expectedContexts ||
          row.inventoried !== expectedFiles
        )
          throw new Error('Snapshot contract failed');
      } else if (response.status === 502 && scenario === 'malformed') {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (value.error?.code !== 'INVALID_UPSTREAM')
          throw new Error('Unexpected malformed response');
        row.errorCode = 'INVALID_UPSTREAM';
        row.complete = true;
      } else {
        row.errorCode = 'PLATFORM_OR_HTTP_ERROR';
        failed++;
      }
      runs.push(row);
      console.log(
        `${scenario} ${i + 1}/8: HTTP ${row.httpStatus}, complete=${row.complete}, ${row.clientWallMs.toFixed(1)} ms client elapsed`,
      );
      await pause(1600);
      if (failed >= 2) break; // Record failure, do not hammer a failing workload.
    }
  }
  // Check denial after the measured cold path, not before it.
  const denied = await fetch(`${origin}/api/review`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  await denied.body?.cancel();
  if (denied.status !== 401) throw new Error('Secret gate verification failed');
  report.end = new Date().toISOString();
  const query = `query($accountTag: string, $start: string, $end: string, $scriptName: string) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 200, filter: {scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end}) {
        dimensions { datetime status } sum { requests errors }
        quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 wallTimeP50 wallTimeP99 startupCpuTimeUsP99 }
      }
    } }
  }`;
  // Metrics have aggregation delay. Six bounded reads, no invocation retries.
  for (let attempt = 0; attempt < 6; attempt++) {
    await pause(30000);
    const measured = await api.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: api.account,
          start,
          end: report.end,
          scriptName: CPU_WORKER_NAME,
        },
      }),
    });
    if (measured.errors?.length)
      throw new Error('Platform metrics unavailable');
    const data = measured.data as {
      viewer: { accounts: { workersInvocationsAdaptive: unknown }[] };
    };
    report.metrics = safeMetrics(
      data.viewer.accounts[0].workersInvocationsAdaptive,
    );
    const count = report.metrics.reduce((n, r) => n + r.requests, 0);
    console.log(`Platform metrics: ${count}/${runs.length + 1} requests`);
    if (count >= runs.length + 1) break;
  }
} catch {
  report.failure = 'EXPERIMENT_ABORTED_SAFELY';
} finally {
  report.end ||= new Date().toISOString();
  if (created) {
    try {
      report.cleanup.deleteStatus = (
        await api.request(script, { method: 'DELETE' })
      ).status;
      report.cleanup.absenceStatus = (
        await api.request(`${script}/settings`)
      ).status;
    } catch {
      report.failure = 'CLEANUP_REQUIRES_OPERATOR_VERIFICATION';
    }
  }
  writeFileSync(
    'docs/milestone-2.5-platform-cpu.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      runs: runs.length,
      metrics: report.metrics.length,
      cleanup: report.cleanup,
      failure: report.failure,
    }),
  );
}
if (report.failure || report.cleanup.absenceStatus !== 404)
  process.exitCode = 1;
