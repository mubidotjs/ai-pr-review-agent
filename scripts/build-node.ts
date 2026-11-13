import { build } from 'vite';
import {
  cp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
} from 'node:fs/promises';
import { resolve, relative } from 'node:path';

await build({ configFile: 'vite.node.config.ts' });
await build({
  configFile: false,
  build: {
    ssr: true,
    outDir: 'dist/node/server',
    sourcemap: true,
    rollupOptions: {
      input: { api: 'api/[...path].ts', local: 'src/server/node-local.ts' },
      output: { entryFileNames: '[name].mjs', chunkFileNames: '[name].mjs' },
    },
  },
  ssr: { noExternal: true },
});
const output = '.vercel/output';
// Rebuild only this generated directory; preserve any separate CLI project metadata.
const workspace = await realpath('.');
const target = resolve(output);
if (
  relative(workspace, target) !==
  ['.vercel', 'output'].join(process.platform === 'win32' ? '\\' : '/')
)
  throw new Error('Unexpected build output path');
await rm(target, { recursive: true, force: true });
await mkdir(`${output}/functions/ingestion.func`, { recursive: true });
for (const name of await readdir('dist/node/server')) {
  if (name.endsWith('.mjs') && name !== 'local.mjs')
    await cp(
      `dist/node/server/${name}`,
      `${output}/functions/ingestion.func/${name}`,
    );
}
await cp('dist/node/client', `${output}/static`, { recursive: true });
await writeFile(
  `${output}/functions/ingestion.func/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs24.x',
    handler: 'api.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 40,
  }),
);
const headers = Object.fromEntries(
  (await readFile('public/_headers', 'utf8'))
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    }),
);
await writeFile(
  `${output}/config.json`,
  JSON.stringify({
    version: 3,
    routes: [
      {
        src: '/(.*)',
        headers: { ...headers, 'Cache-Control': 'no-store' },
        continue: true,
      },
      { src: '/api/(.*)', dest: '/ingestion' },
      { handle: 'filesystem' },
    ],
  }),
);
for (const name of await readdir('dist/node/server')) {
  if (!name.endsWith('.map')) continue;
  const map = JSON.parse(
    await readFile(`dist/node/server/${name}`, 'utf8'),
  ) as { sources: string[] };
  if (
    map.sources.some((path) =>
      /(@babel|src\/analysis|shared\/report|client\/)/.test(
        path.replaceAll('\\', '/'),
      ),
    )
  )
    throw new Error('Analysis leaked into Node backend');
}
console.log(
  'Node boundary verified; local Build Output API artifact requests streaming without body helpers. No deployment performed.',
);
