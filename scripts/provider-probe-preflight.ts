import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { providerProbeApi, UNRELATED_WORKERS } from './provider-probe-api';
import { PROBE_INPUT, PROBE_MODEL } from '../tests/provider-probe-worker';
const api = await providerProbeApi();
const catalog = await api.request(
  `/accounts/${api.account}/ai/models/search?search=gemma-4-26b-a4b-it&per_page=10`,
);
const schema = await api.request(
  `/accounts/${api.account}/ai/models/schema?model=%40cf%2Fgoogle%2Fgemma-4-26b-a4b-it`,
);
const projects = [];
for (const name of UNRELATED_WORKERS) {
  const settings = await api.request(
    `/accounts/${api.account}/workers/scripts/${name}/settings`,
  );
  const deployments = await api.request(
    `/accounts/${api.account}/workers/scripts/${name}/deployments`,
  );
  if (!settings.success || !deployments.success)
    throw new Error('Unrelated project baseline unavailable');
  projects.push({
    name,
    settingsSha256: createHash('sha256')
      .update(JSON.stringify(settings.result))
      .digest('hex'),
    deploymentsSha256: createHash('sha256')
      .update(JSON.stringify(deployments.result))
      .digest('hex'),
  });
}
if (!catalog.success || !schema.success)
  throw new Error('Account-specific model metadata unavailable');
if (
  !Array.isArray(catalog.result) ||
  !catalog.result.some((m: { name?: string }) => m.name === PROBE_MODEL)
)
  throw new Error('Exact model absent from account catalog');
// Only key/type metadata is printed while locating the native schema format.
const metadata = {
  checkedAt: new Date().toISOString(),
  model: PROBE_MODEL,
  catalogStatus: catalog.status,
  schemaStatus: schema.status,
  catalogEntries: Array.isArray(catalog.result)
    ? catalog.result.map((x: { name?: string; properties?: unknown }) => ({
        name: x.name,
        properties: x.properties,
      }))
    : [],
  schemaKeys: Object.keys(schema.result as object),
  projects,
  request: PROBE_INPUT,
};
writeFileSync(
  'artifacts/m3-preflight-metadata.json',
  JSON.stringify(metadata, null, 2),
);
writeFileSync('artifacts/m3-model-schema.json', JSON.stringify(schema.result));
console.log(JSON.stringify(metadata));
