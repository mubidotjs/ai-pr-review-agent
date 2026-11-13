import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { probe, probeCommand } from '../vercel-transport/client';
import { verifyReleaseDeployment } from './configuration';

// Operator only, after explicit release authorization. No deployment/model
// calls and no retries. Consumes each outstanding case once, in order.
const [url, credentialsPath, ledgerPath] = process.argv.slice(2);
const root = resolve('.');
function artifactPath(path: string) {
  if (!path) throw new Error('An ignored artifacts path is required.');
  const result = resolve(path);
  if (!relative(root, result).startsWith('artifacts' + sep))
    throw new Error('Operator files must remain inside ignored artifacts.');
  return result;
}
const credentialsFile = artifactPath(credentialsPath),
  ledgerFile = artifactPath(ledgerPath);
if (credentialsFile === ledgerFile)
  throw new Error('Distinct operator files required.');
const cwd = resolve('artifacts/release-acceptance');
const linked = JSON.parse(
  await readFile(`${cwd}/.vercel/project.json`, 'utf8'),
);
if (
  linked.projectName !== 'mubidotjs-prism' ||
  linked.orgId !== 'team_YxkjSyqiyTtrcBTA8pfTNhpD' ||
  !/^prj_[a-zA-Z0-9]+$/.test(linked.projectId)
)
  throw new Error('Unexpected acceptance project link.');
const cli = process.env.PRISM_VERCEL_CLI;
if (!cli) throw new Error('Set the installed official Vercel CLI JS path.');
probeCommand({
  url,
  scenario: 'maximum',
  transport: { kind: 'vercel', cli, scope: 'mubidotjs-projects', cwd },
});
const manifest = JSON.parse(
  await readFile('artifacts/m45-vercel/manifest.json', 'utf8'),
);
if (
  manifest.applicationDeadlineMs !== 30000 ||
  manifest.config.maxDuration !== 40
)
  throw new Error('Server deadline configuration changed.');
const { stdout } = await promisify(execFile)(
  'git',
  ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'],
  { cwd: root, windowsHide: true },
);
// Read-only platform identity check before transmitting the operator secret.
let deployment;
try {
  const observed = await promisify(execFile)(
    process.execPath,
    [
      cli,
      'api',
      `/v13/deployments/${new URL(url).hostname}`,
      '--method',
      'GET',
      '--scope',
      'mubidotjs-projects',
    ],
    {
      cwd,
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: '1' },
    },
  );
  deployment = JSON.parse(observed.stdout.slice(observed.stdout.indexOf('{')));
} catch {
  throw new Error('Deployment metadata unavailable; stop before requests.');
}
verifyReleaseDeployment(deployment, linked.projectId);
if (
  deployment.url !== new URL(url).hostname ||
  deployment.meta?.prismReleaseSha !== stdout.trim() ||
  deployment.projectSettings?.nodeVersion !== '24.x'
)
  throw new Error('Deployment source/runtime mismatch; stop before requests.');
const secret = JSON.parse(await readFile(credentialsFile, 'utf8')).operator;
if (!/^[a-f0-9]{64}$/.test(secret))
  throw new Error('Operator credential missing.');
const results: {
  sha: string;
  deployment: string;
  project: string;
  cases: unknown[];
  status: string;
} = {
  sha: stdout.trim(),
  deployment: url,
  project: linked.projectId,
  cases: [],
  status: 'STARTED',
};
await mkdir(resolve(ledgerFile, '..'), { recursive: true });
// Refuse an existing ledger; neither crashes nor incomplete attempts authorize replay.
await writeFile(ledgerFile, JSON.stringify(results, null, 2), { flag: 'wx' });
for (const scenario of ['maximum', 'error', 'abort'] as const) {
  results.cases.push({
    scenario,
    attempted: true,
    startedAt: new Date().toISOString(),
  });
  await writeFile(ledgerFile, JSON.stringify(results, null, 2));
  const result = await probe({
    url,
    scenario,
    secret,
    expected: manifest.cases[scenario],
    transport: { kind: 'vercel', cli, scope: 'mubidotjs-projects', cwd },
  });
  results.cases[results.cases.length - 1] = result;
  results.status = result.pass ? 'CONTINUE' : 'FAILED';
  await writeFile(ledgerFile, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
  if (!result.pass)
    throw new Error('Transport acceptance failed; stop and clean up.');
}
// A separate allowlisted platform-event check must still verify server-side
// controlled-error/cancellation before the real-agent acceptance gate opens.
results.status = 'CLIENT_CHECKS_PASSED_SERVER_EVENTS_REQUIRED';
await writeFile(ledgerFile, JSON.stringify(results, null, 2));
