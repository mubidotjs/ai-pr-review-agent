import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DELAY_MS, PREFIX, TAIL } from './harness';

// Operator-only, explicit one-deployment experiment. Never imported by the app/CI.
const TEAM = 'team_YxkjSyqiyTtrcBTA8pfTNhpD',
  SCOPE = 'mubidotjs-projects';
const NAME = 'prism-m45-transport-20261113';
const project = process.argv[2];
assert.ok(
  /^prj_[A-Za-z0-9]+$/.test(project ?? ''),
  'Pass the exact newly created temporary project ID',
);
assert.ok(
  ![
    'prj_hRfp70QSVa7ab6XvU1R1PcpxFIRB',
    'prj_WWscijW5EidqaVE6cOdq3LgoTtaZ',
    'prj_E5hGf3OeleoadyDekWpJdp2h9Giz',
    'prj_v8cVNdWItpf6lGdvvNBuoxjPWM8I',
  ].includes(project),
);
const root = resolve('artifacts/m45-vercel');
const cli = process.env.PRISM_VERCEL_CLI;
assert.ok(
  cli,
  'Set the installed official Vercel CLI JS entry path, not a token',
);
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
assert.equal(manifest.config.runtime, 'nodejs24.x');
assert.equal(manifest.config.maxDuration, 40);
assert.equal(manifest.config.supportsResponseStreaming, true);
assert.equal(manifest.config.shouldAddHelpers, false);
assert.equal(manifest.applicationDeadlineMs, 30000);
const adapter = createHash('sha256')
  .update(await readFile('src/server/node-adapter.ts'))
  .digest('hex');
assert.equal(
  adapter,
  manifest.adapterSha256,
  'Do not change the M4 adapter during acceptance',
);
const started = new Date().toISOString(),
  secret = randomBytes(32).toString('hex');
const results: Record<string, unknown> = {
  baseline: manifest.baseline,
  started,
  project: { id: project, name: NAME, team: TEAM },
  artifact: manifest,
  deploymentAttempts: 0,
  tests: [],
  cleanup: {},
};
const save = () =>
  writeFile(`${root}/result.json`, JSON.stringify(results, null, 2) + '\n');

function command(args: string[], input = '', timeoutMs = 60000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(process.execPath, [cli!, ...args, '--scope', SCOPE], {
        cwd: root,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
      });
      let stdout = '',
        stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('CLI_TIMEOUT'));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (stdout.length > 2 * 1024 * 1024) child.kill();
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 16384) stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        resolvePromise({ code, stdout, stderr });
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    },
  );
}
function jsonObject(text: string) {
  return JSON.parse(text.slice(text.indexOf('{')));
}

// Only bounded fixed metadata is persisted. Cookies and protection headers are discarded.
async function probe(
  url: string,
  scenario: string,
  maxSeconds = 35,
  authenticated = true,
  path = '/api/transport-probe',
) {
  const began = performance.now(),
    hash = createHash('sha256');
  let bytes = 0,
    firstByteMs: number | undefined,
    lastByteMs = 0,
    headerBuffer = Buffer.alloc(0),
    haveHeaders = false,
    status = 0,
    small = Buffer.alloc(0);
  const headers: Record<string, string> = {};
  const permitted = new Set([
    'content-type',
    'content-encoding',
    'cache-control',
    'x-content-type-options',
    'referrer-policy',
    'transfer-encoding',
    'x-prism-snapshot-bytes',
    'x-prism-case',
    'x-prism-delay-ms',
    'x-prism-deadline-ms',
    'x-vercel-id',
  ]);
  const args = [
    cli!,
    'curl',
    path,
    '--deployment',
    url,
    '--scope',
    SCOPE,
    '--',
    '--config',
    '-',
  ];
  return new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
    });
    const watchdog = setTimeout(
      () => {
        child.kill();
        reject(new Error('CLIENT_WATCHDOG'));
      },
      (maxSeconds + 25) * 1000,
    );
    const body = (data: Buffer) => {
      if (!data.length) return;
      firstByteMs ??= Math.round(performance.now() - began);
      lastByteMs = Math.round(performance.now() - began);
      bytes += data.length;
      hash.update(data);
      if (small.length < 2048)
        small = Buffer.concat([small, data.subarray(0, 2048 - small.length)]);
      if (bytes > 12582912) child.kill();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (haveHeaders) return body(chunk);
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const end = headerBuffer.indexOf('\r\n\r\n');
      if (end < 0) {
        if (headerBuffer.length > 16384) child.kill();
        return;
      }
      const lines = headerBuffer
        .subarray(0, end)
        .toString('latin1')
        .split('\r\n');
      status = Number(lines[0].match(/^HTTP\/\S+ (\d+)/)?.[1] ?? 0);
      // The request sends an empty body, so no interim 100 response is expected.
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon).toLowerCase();
        if (permitted.has(name)) headers[name] = line.slice(colon + 1).trim();
      }
      haveHeaders = true;
      body(headerBuffer.subarray(end + 4));
      headerBuffer = Buffer.alloc(0);
    });
    // CLI/curl stderr may contain auth diagnostics. Never persist or print it.
    let clientError: string | undefined;
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (/curl: option .* is unknown/.test(text))
        clientError = 'CLIENT_OPTION_REJECTED';
      else if (/curl: \(28\)/.test(text)) clientError = 'CLIENT_TIMEOUT';
      else if (
        /No existing credentials|not authenticated|login required/i.test(text)
      )
        clientError = 'CLI_AUTH_UNAVAILABLE';
    });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      clearTimeout(watchdog);
      const digest = hash.digest('hex');
      const expected = manifest.cases[scenario];
      const success =
        status === 200 &&
        exitCode === 0 &&
        headers['cache-control'] === 'no-store';
      let pass = false;
      if (expected)
        pass =
          success && bytes === expected.bytes && digest === expected.sha256;
      else if (scenario === 'delayed')
        pass =
          success &&
          small.toString() === PREFIX + TAIL &&
          firstByteMs !== undefined &&
          firstByteMs < DELAY_MS &&
          lastByteMs - firstByteMs >= DELAY_MS - 100;
      else if (scenario === 'error')
        pass =
          status === 200 &&
          bytes === 4 &&
          digest ===
            createHash('sha256')
              .update(new Uint8Array([0, 0, 4, 0]))
              .digest('hex') &&
          bytes < Number(headers['x-prism-snapshot-bytes']);
      else if (scenario === 'abort')
        pass =
          status === 200 && exitCode === 28 && bytes > 0 && bytes < 40 * 65536;
      else if (scenario === 'unauthorized')
        pass = status === 401 && bytes === 0;
      else if (scenario === 'real-route-absent') pass = status === 404;
      resolvePromise({
        scenario,
        clientError,
        pass,
        status,
        exitCode,
        bytes,
        sha256: digest,
        firstByteMs,
        lastByteMs,
        elapsedMs: Math.round(performance.now() - began),
        headers,
        eof: exitCode === 0,
        ...(expected
          ? {
              expectedBytes: expected.bytes,
              expectedSha256: expected.sha256,
              exactIntegrity:
                bytes === expected.bytes && digest === expected.sha256,
            }
          : {}),
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(
      [
        'request = "POST"',
        'data = ""',
        'include',
        'no-buffer',
        'silent',
        'show-error',
        'suppress-connect-headers',
        `max-time = ${maxSeconds}`,
        'retry = 0',
        'header = "Accept-Encoding: identity"',
        'header = "Expect:"',
        `header = "X-Prism-Case: ${scenario}"`,
        ...(authenticated ? [`header = "X-Prism-Probe: ${secret}"`] : []),
      ].join('\n') + '\n',
    );
  });
}

let deploymentId: string | undefined, deploymentUrl: string | undefined;
let verifiedTemporaryProject = false;
try {
  await mkdir(`${root}/.vercel`, { recursive: true });
  await writeFile(
    `${root}/.vercel/project.json`,
    JSON.stringify({ projectId: project, orgId: TEAM, projectName: NAME }),
  );
  const inspection = await command([
    'project',
    'inspect',
    NAME,
    '--json',
    '--non-interactive',
  ]);
  assert.equal(inspection.code, 0, 'Cannot inspect exact temporary project');
  const inspected = jsonObject(inspection.stdout);
  assert.equal(inspected.id ?? inspected.project?.id, project);
  assert.equal(inspected.name ?? inspected.project?.name, NAME);
  const ownershipLookup = await command([
    'api',
    `/v9/projects/${project}`,
    '--method',
    'GET',
  ]);
  assert.equal(ownershipLookup.code, 0);
  const ownership = jsonObject(ownershipLookup.stdout);
  assert.equal(ownership.id, project);
  assert.equal(ownership.name, NAME);
  assert.equal(ownership.accountId, TEAM);
  verifiedTemporaryProject = true;
  const auth = await command(
    [
      'env',
      'add',
      'PRISM_TRANSPORT_SECRET',
      'preview,production',
      '--sensitive',
      '--project',
      project,
      '--yes',
    ],
    secret,
  );
  assert.equal(auth.code, 0, 'Could not set backend-only secret');
  const expiry = await command(
    [
      'env',
      'add',
      'PRISM_PROBE_EXPIRES',
      'preview,production',
      '--project',
      project,
      '--force',
      '--yes',
    ],
    String(Date.now() + 20 * 60 * 1000),
  );
  assert.equal(expiry.code, 0, 'Could not set hard probe expiry');
  results.deploymentAttempts = 1;
  await save();
  const deployment = await command(
    [
      'deploy',
      '--prebuilt',
      '--project',
      project,
      '--target',
      'preview',
      '--yes',
      '--json',
    ],
    '',
    180000,
  );
  if (deployment.code !== 0) {
    results.deploymentFailure = {
      exitCode: deployment.code,
      category: 'DEPLOYMENT_REJECTED',
      safeDiagnostic: deployment.stderr
        .replaceAll(secret, '[REDACTED]')
        .slice(-2000),
    };
    throw new Error('DEPLOYMENT_REJECTED');
  }
  const deployed = jsonObject(deployment.stdout);
  deploymentId =
    deployed.id ?? deployed.deploymentId ?? deployed.deployment?.id;
  deploymentUrl = deployed.url ?? deployed.deployment?.url;
  if (!deploymentId || !deploymentUrl) {
    const lookup = await command([
      'api',
      `/v9/projects/${project}`,
      '--method',
      'GET',
    ]);
    const latest = jsonObject(lookup.stdout).latestDeployments;
    assert.equal(
      latest?.length,
      1,
      'Expected exactly one deployment of this isolated project',
    );
    deploymentId = latest[0].id;
    deploymentUrl = latest[0].url;
  }
  assert.ok(
    deploymentId?.startsWith('dpl_') && deploymentUrl,
    'Unrecognized deployment identity',
  );
  assert.ok(deploymentId);
  assert.ok(deploymentUrl);
  if (!deploymentUrl.startsWith('https://'))
    deploymentUrl = `https://${deploymentUrl}`;
  results.deployment = {
    id: deploymentId,
    url: deploymentUrl,
    readyState: deployed.readyState ?? deployed.deployment?.readyState,
  };
  const deployedLookup = await command([
    'api',
    `/v13/deployments/${deploymentId}`,
    '--method',
    'GET',
  ]);
  assert.equal(deployedLookup.code, 0);
  const platformDeployment = jsonObject(deployedLookup.stdout);
  Object.assign(results.deployment as object, {
    requestedTarget: 'preview',
    observedTarget: platformDeployment.target,
    nodeVersion: platformDeployment.projectSettings?.nodeVersion,
  });
  const bindingLookup = await command([
    'api',
    `/v9/projects/${project}`,
    '--method',
    'GET',
  ]);
  const bindings = jsonObject(bindingLookup.stdout).env as {
    key: string;
    target: string[];
  }[];
  for (const key of ['PRISM_TRANSPORT_SECRET', 'PRISM_PROBE_EXPIRES'])
    assert.ok(
      bindings.some(
        (binding) =>
          binding.key === key &&
          binding.target.includes(platformDeployment.target ?? 'preview'),
      ),
      'Deployed target lacks a required binding',
    );
  await save();
  console.log(
    JSON.stringify({ event: 'deployed', ...(results.deployment as object) }),
  );
  const tests = results.tests as unknown[];
  const authGate = await probe(deploymentUrl, 'unauthorized', 15, false);
  tests.push(authGate);
  await save();
  assert.equal(
    authGate.pass,
    true,
    'Authentication/configuration gate failed before fixture tests',
  );
  for (const scenario of [
    'delayed',
    'ingestion',
    'maximum',
    'error',
    'abort',
  ]) {
    const result = await probe(
      deploymentUrl,
      scenario,
      scenario === 'abort' ? 2 : 35,
    );
    tests.push(result);
    await save();
    console.log(JSON.stringify(result));
  }
  for (const [scenario, path, authenticated] of [
    ['real-route-absent', '/api/review', true],
  ] as const) {
    const result = await probe(
      deploymentUrl,
      scenario,
      15,
      authenticated,
      path,
    );
    tests.push(result);
    await save();
    console.log(JSON.stringify(result));
  }
  // Allow the single aborted invocation to reach either cancellation or its bounded source end.
  console.log(JSON.stringify({ event: 'collecting-platform-evidence' }));
  await new Promise((resolve) => setTimeout(resolve, 15000));
  const logs = await command([
    'logs',
    '--deployment',
    deploymentId,
    '--project',
    project,
    '--since',
    started,
    '--limit',
    '200',
    '--json',
  ]);
  const safeLogs: unknown[] = [];
  for (const line of logs.stdout.split('\n')) {
    try {
      const row = JSON.parse(line),
        raw = row.message ?? row.text ?? row.data?.message;
      if (typeof raw !== 'string') continue;
      const event = JSON.parse(raw).prismTransport;
      if (
        event &&
        ['delayed', 'ingestion', 'maximum', 'error', 'abort'].includes(
          event.case,
        ) &&
        [
          'start',
          'tail-produced',
          'complete',
          'cancelled',
          'request-aborted',
          'controlled-error',
        ].includes(event.event)
      )
        safeLogs.push({
          case: event.case,
          event: event.event,
          bytes: event.bytes,
          elapsedMs: event.elapsedMs,
          node: event.node,
          requestId: row.requestId,
          timestamp: row.timestamp,
        });
    } catch {
      /* Ignore platform diagnostics; never persist arbitrary logs. */
    }
  }
  results.platformEvents = safeLogs;
  results.logsQueryExitCode = logs.code;
  const metrics: Record<string, unknown> = {};
  for (const metric of [
    'count',
    'function_duration_ms',
    'function_cpu_time_ms',
    'peak_memory_mb',
  ]) {
    const query = await command([
      'metrics',
      `vercel.function_invocation.${metric}`,
      '--project',
      project,
      '--since',
      started,
      '--json',
    ]);
    try {
      const data = JSON.parse(query.stdout);
      if (data.error?.code === 'payment_required') {
        metrics[metric] = {
          exitCode: query.code,
          unavailable: true,
          reason: 'OBSERVABILITY_PLUS_REQUIRES_PRO',
        };
        break;
      }
      metrics[metric] = {
        exitCode: query.code,
        data,
      };
    } catch {
      metrics[metric] = { exitCode: query.code, unavailable: true };
    }
  }
  results.metrics = metrics;
  results.transportPass = (tests as { pass: boolean }[]).every(
    (test) => test.pass,
  );
  results.cancellationVerified = (
    safeLogs as { case: string; event: string; elapsedMs: number }[]
  ).some(
    (event) =>
      event.case === 'abort' &&
      event.event === 'cancelled' &&
      event.elapsedMs < 30000,
  );
  results.acceptance =
    results.transportPass && results.cancellationVerified
      ? 'PASS'
      : 'FAIL_OR_NOT_VERIFIED';
  await save();
} catch (error) {
  results.failure =
    error instanceof Error &&
    ['DEPLOYMENT_REJECTED', 'CLI_TIMEOUT', 'CLIENT_WATCHDOG'].includes(
      error.message,
    )
      ? error.message
      : 'EXPERIMENT_STOPPED_SAFELY';
  results.acceptance = 'NOT_VERIFIED';
  await save();
} finally {
  // Remove only this explicitly identified disposable project, its deployment and secret.
  const cleanup: Record<string, unknown> = {};
  if (verifiedTemporaryProject) {
    const secretRemoval: Record<string, number | null> = {};
    for (const target of ['preview', 'production']) {
      const env = await command([
        'env',
        'rm',
        'PRISM_TRANSPORT_SECRET',
        target,
        '--project',
        project,
        '--yes',
      ]);
      secretRemoval[target] = env.code;
    }
    cleanup.secretRemovalExitCodes = secretRemoval;
    if (deploymentId) {
      const removal = await command(['remove', deploymentId, '--yes']);
      cleanup.deploymentRemovalExitCode = removal.code;
    }
    const removal = await command([
      'api',
      `/v9/projects/${project}`,
      '--method',
      'DELETE',
      '--dangerously-skip-permissions',
    ]);
    cleanup.projectRemovalExitCode = removal.code;
    const absent = await command([
      'api',
      `/v9/projects/${project}`,
      '--method',
      'GET',
    ]);
    cleanup.projectLookupExitCode = absent.code;
    if (deploymentUrl) {
      try {
        const response = await fetch(`${deploymentUrl}/api/transport-probe`, {
          method: 'POST',
          headers: { 'X-Prism-Probe': secret, 'X-Prism-Case': 'delayed' },
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
        cleanup.finalHttpStatus = response.status;
        await response.body?.cancel();
        cleanup.inaccessible =
          response.status === 404 || response.status === 410;
      } catch {
        cleanup.inaccessible = true;
        cleanup.finalCategory = 'NETWORK_UNAVAILABLE';
      }
    }
  } else cleanup.skippedUnverifiedTarget = true;
  results.cleanup = cleanup;
  results.finished = new Date().toISOString();
  await save();
  console.log(
    JSON.stringify({
      event: 'experiment-finished',
      acceptance: results.acceptance,
      cleanup,
    }),
  );
}
