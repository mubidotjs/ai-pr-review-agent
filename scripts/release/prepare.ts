import { build } from 'vite';
import { cp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
// LOCAL preparation only. Requires build:node and prepare:transport-probe first.
// The normal build never includes fixtures, operator routes, or operator secrets.
const output = 'artifacts/release-acceptance/.vercel/output';
const workspace = await realpath('.'),
  target = resolve(output);
if (
  relative(workspace, target) !==
  ['artifacts', 'release-acceptance', '.vercel', 'output'].join(sep)
)
  throw new Error('Unexpected acceptance output path');
await rm(target, { recursive: true, force: true });
await cp('.vercel/output', output, { recursive: true });
await cp(
  'artifacts/m45-vercel/.vercel/output/functions/api/transport-probe.func',
  `${output}/functions/api/transport-probe.func`,
  { recursive: true },
);
const fn = `${output}/functions/acceptance-agent.func`;
await build({
  configFile: false,
  build: {
    ssr: 'scripts/release/acceptance-agent.ts',
    outDir: fn,
    rollupOptions: { output: { entryFileNames: 'index.mjs' } },
  },
  ssr: { noExternal: true },
});
await writeFile(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs24.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    supportsCancellation: true,
    maxDuration: 40,
  }),
);
const config = JSON.parse(await readFile(`${output}/config.json`, 'utf8'));
config.routes.splice(
  1,
  0,
  { src: '/api/transport-probe', dest: '/api/transport-probe' },
  { src: '/api/acceptance-agent', dest: '/acceptance-agent' },
);
await writeFile(`${output}/config.json`, JSON.stringify(config));
console.log(
  'Prepared isolated release acceptance artifact locally. No resources created; no inference.',
);
