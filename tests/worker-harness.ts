import { createApp } from '../src/server/index';
import {
  benchmarkCases,
  makePerformanceInput,
  performanceTransport,
} from './performance-fixtures';
import { GitHubClient } from '../src/server/github';
import {
  addition,
  apiPr,
  benchmarkSource,
  fixtureTransport,
  sources,
} from './upstream-fixtures';

const realistic = benchmarkSource(128);
const largeFiles = Array.from({ length: 6 }, (_, i) => ({
  ...addition(`src/file${i}.ts`, realistic),
  status: 'modified',
  additions: 1,
  patch: `@@ -0,0 +1 @@\n+${realistic.split('\n')[0]}`,
}));
const largeSources = Object.fromEntries(
  largeFiles.map((f) => [f.path, realistic]),
);
const normal = createApp(fixtureTransport());
const large = createApp(
  fixtureTransport(largeFiles, largeSources, apiPr({ changed_files: 6 })),
);
const scenarios = new Map(
  benchmarkCases.map((spec) => [
    spec.name,
    createApp(performanceTransport(makePerformanceInput(spec))),
  ]),
);
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/local-upstream')
      return new Response(JSON.stringify({ native: true }));
    if (url.pathname === '/local-redirect')
      return new Response(null, {
        status: 302,
        headers: { Location: '/local-upstream' },
      });
    if (
      url.pathname === '/native-fetch-check' ||
      url.pathname === '/native-redirect-check'
    ) {
      const upstream = new URL(
        url.pathname === '/native-fetch-check'
          ? '/local-upstream'
          : '/local-redirect',
        request.url,
      );
      const client = new GitHubClient((_input, init) => fetch(upstream, init));
      try {
        return new Response(await client.request('/repos/local/fixture'));
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Failed',
          }),
          { status: 502 },
        );
      }
    }
    if (url.pathname === '/health')
      return new Response(
        JSON.stringify({
          fixture: true,
          sourceCount: Object.keys(sources).length,
        }),
      );
    const scenario = request.headers.get('x-benchmark');
    return (
      scenario === 'large' ? large : (scenarios.get(scenario ?? '') ?? normal)
    ).fetch(request);
  },
};
