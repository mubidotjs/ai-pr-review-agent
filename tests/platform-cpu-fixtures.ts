import type { Transport } from '../src/server/github';
import type { ChangedFile } from '../src/shared/types';
import { makePerformanceInput } from './performance-fixtures';
import { addition, apiFile, apiPr, HEAD } from './upstream-fixtures';

export const CPU_CASES = [
  'small-1',
  'small-4',
  'medium-6x16',
  'large-6x128',
  'large-patches',
  'paginated-100',
  'malformed',
  'incomplete',
  'missing-source',
  'oversized-source',
] as const;
export type CpuCase = (typeof CPU_CASES)[number];

// Fixed synthetic responses only. Encode before requests so the hot invocation
// measures response consumption, not JSON generation on behalf of GitHub.
export function cpuFixtureTransport(name: CpuCase): Transport {
  const spec = {
    name,
    files: name === 'small-1' ? 1 : name === 'small-4' ? 4 : 6,
    kib: name === 'large-6x128' ? 128 : name === 'large-patches' ? 64 : 16,
    extension: 'ts' as const,
    nested: false,
    largeDiff: name === 'large-patches',
  };
  const input = makePerformanceInput(spec);
  const files: ChangedFile[] = input.files.map((f) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
  const contexts = new Map(input.files.map((f) => [f.path, f.context!.text]));
  if (name === 'paginated-100') {
    for (let i = files.length; i < 100; i++)
      files.push(addition(`docs/file${i}.md`, 'Synthetic documentation.'));
  }
  if (name === 'incomplete') {
    files[0].patch = undefined;
    files[1].patch = '@@ -0,0 +1,2 @@\n+truncated';
  }
  if (name === 'oversized-source')
    contexts.set(files[0].path, 'x'.repeat(128 * 1024 + 1));
  const encode = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
  const repo = encode({ full_name: 'example/checkout', private: false });
  const metadata = encode(apiPr({ changed_files: files.length }));
  const pages = [
    encode(files.slice(0, 50).map(apiFile)),
    encode(files.slice(50).map(apiFile)),
  ];
  const sources = new Map(
    [...contexts].map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );
  const notFound = encode({ message: 'Not Found' });
  return async (address, init) => {
    const url = new URL(address);
    if (
      url.origin !== 'https://api.github.com' ||
      init.method !== 'GET' ||
      init.redirect !== 'manual'
    )
      throw new Error('Synthetic transport boundary violated');
    let bytes: Uint8Array<ArrayBuffer> = notFound;
    let status = 200;
    if (url.pathname === '/repos/example/checkout') bytes = repo;
    else if (url.pathname === '/repos/example/checkout/pulls/42')
      bytes =
        name === 'malformed' ? new TextEncoder().encode('{invalid') : metadata;
    else if (url.pathname === '/repos/example/checkout/pulls/42/files')
      bytes = pages[Number(url.searchParams.get('page')) - 1] ?? notFound;
    else if (url.pathname.startsWith('/repos/example/checkout/contents/')) {
      if (url.searchParams.get('ref') !== HEAD)
        throw new Error('Unpinned fixture request');
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]);
      const source = sources.get(path);
      if (!source || (name === 'missing-source' && path === files[0].path))
        status = 404;
      else bytes = source;
    } else status = 404;
    return new Response(bytes, {
      status,
      headers: {
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '45',
        'x-ratelimit-used': '15',
        'x-ratelimit-reset': '2000000000',
      },
    });
  };
}
