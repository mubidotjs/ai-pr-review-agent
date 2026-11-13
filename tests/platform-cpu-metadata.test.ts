import { expect, it } from 'vitest';
import {
  CPU_WORKER_NAME,
  permittedPlatformRequest,
  safeMetrics,
} from '../scripts/platform-cpu-metadata';

it('limits cloud mutations to the one disposable Worker', () => {
  const root = '/accounts/account/workers';
  expect(
    permittedPlatformRequest(
      'account',
      `${root}/scripts/${CPU_WORKER_NAME}`,
      'PUT',
    ),
  ).toBe(true);
  expect(
    permittedPlatformRequest(
      'account',
      `${root}/scripts/${CPU_WORKER_NAME}`,
      'DELETE',
    ),
  ).toBe(true);
  for (const path of [
    `${root}/scripts/other-project`,
    `${root}/account-settings`,
    `${root}/subdomain`,
    `${root}/scripts/${CPU_WORKER_NAME}/secrets`,
    '/accounts/account/ai/run/model',
    '/accounts/account/subscriptions',
  ])
    expect(permittedPlatformRequest('account', path, 'PUT')).toBe(false);
  expect(
    permittedPlatformRequest(
      'other',
      `${root}/scripts/${CPU_WORKER_NAME}`,
      'DELETE',
    ),
  ).toBe(false);
});
it('persists only bounded platform CPU metadata', () => {
  const row = {
    dimensions: {
      datetime: '2026-11-13T00:00:00Z',
      status: 'success',
      source: 'do not store',
    },
    sum: { requests: 1, errors: 0 },
    quantiles: {
      cpuTimeP50: 1200,
      cpuTimeP95: 1200,
      cpuTimeP99: 1200,
      wallTimeP50: 2000,
      wallTimeP99: 2000,
      startupCpuTimeUsP99: 100,
    },
    headers: { Authorization: 'do not store' },
    body: 'do not store',
    logs: ['do not store'],
  };
  const result = safeMetrics([row]);
  expect(JSON.stringify(result)).not.toContain('do not store');
  expect(result[0].cpuTimeP99).toBe(1200);
  expect(() => safeMetrics(Array(201).fill(row))).toThrow();
  expect(() =>
    safeMetrics([
      {
        ...row,
        dimensions: { ...row.dimensions, status: 'arbitrary content' },
      },
    ]),
  ).toThrow();
  expect(() =>
    safeMetrics([
      { ...row, quantiles: { ...row.quantiles, cpuTimeP50: 'secret' } },
    ]),
  ).toThrow();
});
