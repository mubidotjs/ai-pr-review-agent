import { expect, it } from 'vitest';
import {
  probeApiAllowed,
  PROVIDER_WORKER,
  UNRELATED_WORKERS,
} from '../scripts/provider-probe-api';
import { verifyProbeContract } from '../scripts/provider-probe-contract';

it('permits mutations only to the disposable probe, never other projects or REST inference', () => {
  const root = '/accounts/example/workers/scripts';
  expect(probeApiAllowed('example', `${root}/${PROVIDER_WORKER}`, 'PUT')).toBe(
    true,
  );
  for (const name of UNRELATED_WORKERS) {
    expect(probeApiAllowed('example', `${root}/${name}/settings`, 'GET')).toBe(
      true,
    );
    expect(
      probeApiAllowed('example', `${root}/${name}/deployments`, 'GET'),
    ).toBe(true);
    expect(probeApiAllowed('example', `${root}/${name}`, 'PUT')).toBe(false);
    expect(probeApiAllowed('example', `${root}/${name}`, 'DELETE')).toBe(false);
  }
  expect(
    probeApiAllowed('example', '/accounts/example/ai/run/model', 'POST'),
  ).toBe(false);
  expect(
    probeApiAllowed('example', '/accounts/example/subscriptions', 'POST'),
  ).toBe(false);
});
it('stops before provisioning when the current model contract no longer matches', () => {
  expect(() => verifyProbeContract({})).toThrow();
  expect(() =>
    verifyProbeContract({
      input: {
        type: 'object',
        required: ['messages'],
        properties: { messages: { type: 'array' } },
      },
    }),
  ).toThrow();
  expect(() => verifyProbeContract({ input: { type: 'string' } })).toThrow();
});
