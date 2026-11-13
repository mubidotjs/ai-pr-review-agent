import { readFileSync, readdirSync } from 'node:fs';
const backend = JSON.parse(
  readFileSync('dist/ai_pr_review_agent/index.js.map', 'utf8'),
) as { sources: string[] };
const forbidden = backend.sources.filter((path) =>
  /(@babel|src\/analysis|shared\/report|client\/|server\/agent(?:\/|\.))/.test(
    path.replaceAll('\\', '/'),
  ),
);
if (forbidden.length)
  throw new Error(
    `Heavy analysis leaked into backend: ${forbidden.join(', ')}`,
  );
const worker = readdirSync('dist/client/assets').find((name) =>
  /^review\.worker-.*\.js$/.test(name),
);
if (!worker) throw new Error('Dedicated browser Worker asset missing.');
const source = readFileSync(`dist/client/assets/${worker}`, 'utf8');
if (
  !source.includes('NaN comparison cannot test for NaN') ||
  !source.includes('JWT exp claim validation disabled')
)
  throw new Error('Review rules missing from browser Worker.');
console.log(
  `Boundary verified: ${worker}; backend has no Babel, analysis modules, report generation, or client code.`,
);
