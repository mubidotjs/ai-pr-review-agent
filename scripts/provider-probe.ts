import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import {
  providerProbeApi,
  PROVIDER_WORKER,
  UNRELATED_WORKERS,
} from './provider-probe-api';
import { verifyProbeContract } from './provider-probe-contract';
import { PROBE_MODEL } from '../tests/provider-probe-worker';

// Operator-only one-shot. Never run by CI, dev, preview, or the application.
const output = 'docs/milestone-3-provider-result.json';
if (existsSync(output))
  throw new Error('Experiment already recorded; no second dispatch permitted');
if (process.env.PRISM_PROBE_PREFLIGHT_CONFIRMED !== 'true')
  throw new Error(
    'All mandatory account/Free/quota/catalog/budget checks must be confirmed first',
  );
const before = JSON.parse(
  readFileSync('artifacts/m3-preflight-metadata.json', 'utf8'),
) as {
  checkedAt: string;
  projects: {
    name: string;
    settingsSha256: string;
    deploymentsSha256: string;
  }[];
};
if (Date.now() - Date.parse(before.checkedAt) > 1800000)
  throw new Error('Preflight stale');
const contractText = readFileSync('artifacts/m3-model-schema.json', 'utf8');
const validated = verifyProbeContract(JSON.parse(contractText));
const code = readFileSync('artifacts/provider-probe/provider-probe-worker.js');
const api = await providerProbeApi();
if ((await api.request(`${api.script}/settings`)).status !== 404)
  throw new Error('Refusing to overwrite existing Worker');
const result = {
  schemaVersion: 1,
  baseline: '206e470e415c9d21ce25681970a6da9e2bd1d352',
  worker: PROVIDER_WORKER,
  startedAt: new Date().toISOString(),
  endedAt: '',
  model: PROBE_MODEL,
  preflight: {
    freePlan: 'Verified signed-in dashboard',
    neuronsUsedToday: 0,
    neuronsDailyQuota: 10000,
    neuronCostEstimate: 3.200032,
    neuronExperimentBudget: 10,
    estimateIsEnforceableQuota: false,
    contractSha256: createHash('sha256').update(contractText).digest('hex'),
    ...validated,
  },
  sourceSha256: createHash('sha256').update(code).digest('hex'),
  version: '',
  config: {
    compatibilityDate: '2026-11-13',
    bindings: ['AI:ai', 'PROBE_SECRET:secret_text', 'PROBE_EXPIRES:plain_text'],
    logs: false,
    traces: false,
    publicFrontend: false,
    clientTimeoutMs: 20000,
    workerTimeoutMs: 18000,
  },
  inferenceDispatches: 0,
  clientHttpStatus: 0,
  clientLatencyMs: 0,
  probe: null as unknown,
  decision: 'not verified',
  failure: '',
  unrelatedBefore: before.projects,
  unrelatedAfter: [] as {
    name: string;
    settingsSha256: string;
    deploymentsSha256: string;
  }[],
  unrelatedUnchanged: false,
  cleanup: {
    routeDisableStatus: 0,
    deleteStatus: 0,
    absentStatus: 0,
    publicStatus: 0,
    secretRemovedWithWorker: false,
  },
};
const persist = () =>
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
const secret = randomBytes(32).toString('hex');
let attemptedUpload = false,
  origin = '';
try {
  // Reconfirm unrelated deployments/settings immediately before provisioning.
  for (const project of before.projects) {
    for (const [suffix, expected] of [
      ['settings', project.settingsSha256],
      ['deployments', project.deploymentsSha256],
    ]) {
      const current = await api.request(
        `/accounts/${api.account}/workers/scripts/${project.name}/${suffix}`,
      );
      if (
        !current.success ||
        createHash('sha256')
          .update(JSON.stringify(current.result))
          .digest('hex') !== expected
      )
        throw new Error('Unrelated baseline changed');
    }
  }
  const subdomain = await api.request(
    `/accounts/${api.account}/workers/subdomain`,
  );
  const host = (subdomain.result as { subdomain?: string })?.subdomain;
  if (!host || !/^[a-z\d-]+$/.test(host)) throw new Error('Invalid subdomain');
  origin = `https://${PROVIDER_WORKER}.${host}.workers.dev`;
  const form = new FormData();
  form.set(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          main_module: 'provider-probe-worker.js',
          compatibility_date: '2026-11-13',
          usage_model: 'standard',
          observability: { enabled: false },
          bindings: [
            { type: 'ai', name: 'AI' },
            { type: 'secret_text', name: 'PROBE_SECRET', text: secret },
            {
              type: 'plain_text',
              name: 'PROBE_EXPIRES',
              text: String(Date.now() + 1800000),
            },
          ],
        }),
      ],
      { type: 'application/json' },
    ),
  );
  form.set(
    'provider-probe-worker.js',
    new Blob([code], { type: 'application/javascript+module' }),
    'provider-probe-worker.js',
  );
  attemptedUpload = true;
  const uploaded = await api.request(api.script, { method: 'PUT', body: form });
  if (!uploaded.success) throw new Error('Upload failed');
  result.version =
    (uploaded.result as { deployment_id?: string; etag?: string })
      .deployment_id ??
    (uploaded.result as { etag?: string }).etag ??
    'not returned';
  const enable = await api.request(`${api.script}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  if (!enable.success) throw new Error('Route unavailable');
  let ready = false;
  // Read-only method-rejection checks cannot invoke AI.run. No POST is retried.
  for (let i = 0; i < 5; i++) {
    await pause(3000);
    const response = await fetch(`${origin}/api/provider-probe`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (
      response.status === 405 &&
      response.headers.get('X-Prism-Probe') === 'm3-v1'
    ) {
      const body = await response.json();
      ready = body.bindingConfigured === true;
    } else await response.body?.cancel();
    if (ready) break;
  }
  if (!ready) throw new Error('Protected native binding route not ready');
  const unauthenticated = await fetch(`${origin}/api/provider-probe`, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  await unauthenticated.body?.cancel();
  if (unauthenticated.status !== 401)
    throw new Error('Secret protection not verified');
  // Reserve the ONLY attempt durably as safe metadata before sending it. A
  // timeout/crash/unknown delivery never authorizes re-running this script.
  result.inferenceDispatches = 1;
  persist();
  const started = performance.now();
  try {
    const response = await fetch(`${origin}/api/provider-probe`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    result.clientHttpStatus = response.status;
    const text = await response.text();
    if (text.length > 8192 || response.headers.get('X-Prism-Probe') !== 'm3-v1')
      throw new Error('Unexpected probe response');
    result.probe = JSON.parse(text); // Already explicitly sanitized by the fixed probe.
    const probe = result.probe as {
      category?: string;
      bindingInvocations?: number;
      providerStatus?: number;
    };
    if (
      probe.category === 'NONEMPTY_MODEL_RESPONSE' &&
      probe.bindingInvocations === 1 &&
      probe.providerStatus === 200
    )
      result.decision = 'provider path viable';
  } catch {
    result.failure = 'SINGLE_DISPATCH_TIMEOUT_OR_UNVERIFIED_RESPONSE';
  } finally {
    result.clientLatencyMs = performance.now() - started;
    persist();
  }
} catch {
  result.failure ||= result.inferenceDispatches
    ? 'SINGLE_ATTEMPT_NOT_VERIFIED'
    : 'PREFLIGHT_OR_PROVISIONING_STOP';
} finally {
  if (attemptedUpload) {
    try {
      result.cleanup.routeDisableStatus = (
        await api.request(`${api.script}/subdomain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false, previews_enabled: false }),
        })
      ).status;
    } catch {
      result.failure ||= 'ROUTE_DISABLE_REQUIRES_VERIFICATION';
    }
    try {
      result.cleanup.deleteStatus = (
        await api.request(api.script, { method: 'DELETE' })
      ).status;
      result.cleanup.absentStatus = (
        await api.request(`${api.script}/settings`)
      ).status;
      result.cleanup.secretRemovedWithWorker =
        result.cleanup.deleteStatus === 200 &&
        result.cleanup.absentStatus === 404;
      for (let i = 0; origin && i < 4; i++) {
        await pause(3000);
        const response = await fetch(`${origin}/api/provider-probe`, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        });
        result.cleanup.publicStatus = response.status;
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) break;
      }
    } catch {
      result.failure ||= 'CLEANUP_REQUIRES_VERIFICATION';
    }
  }
  for (const name of UNRELATED_WORKERS) {
    try {
      const settings = await api.request(
        `/accounts/${api.account}/workers/scripts/${name}/settings`,
      );
      const deployments = await api.request(
        `/accounts/${api.account}/workers/scripts/${name}/deployments`,
      );
      if (!settings.success || !deployments.success)
        result.failure ||= 'UNRELATED_METADATA_CHECK_UNAVAILABLE';
      else
        result.unrelatedAfter.push({
          name,
          settingsSha256: createHash('sha256')
            .update(JSON.stringify(settings.result))
            .digest('hex'),
          deploymentsSha256: createHash('sha256')
            .update(JSON.stringify(deployments.result))
            .digest('hex'),
        });
    } catch {
      result.failure ||= 'UNRELATED_METADATA_CHECK_UNAVAILABLE';
    }
  }
  result.unrelatedUnchanged =
    JSON.stringify(result.unrelatedBefore) ===
    JSON.stringify(result.unrelatedAfter);
  result.endedAt = new Date().toISOString();
  persist();
  console.log(
    JSON.stringify({
      decision: result.decision,
      inferenceDispatches: result.inferenceDispatches,
      cleanup: result.cleanup,
      unrelatedUnchanged: result.unrelatedUnchanged,
      failure: result.failure,
    }),
  );
}
