import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// Compilation only. This script cannot provision a Worker, binding or namespace.
const result = spawnSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'deploy',
    '--dry-run',
    '--config',
    'wrangler.ai.jsonc',
    '--outdir',
    'dist/ai-relay',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: resolve('artifacts/wrangler-build-logs'),
    },
  },
);
if (result.error || result.status !== 0)
  throw new Error('AI relay dry build failed.');
