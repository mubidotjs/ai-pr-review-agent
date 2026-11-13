import { expect, it } from 'vitest';
import {
  REQUIRED_RELEASE_ENV,
  verifyReleaseEnvironment,
  verifyReleaseDeployment,
} from '../scripts/release/configuration';
it('requires both environment targets rather than assuming the first deployment is Preview', () => {
  const entries = REQUIRED_RELEASE_ENV.map((key) => ({
    key,
    target: ['preview'],
  }));
  expect(() => verifyReleaseEnvironment(entries)).toThrow(/production/);
  for (const entry of entries) entry.target.push('production');
  expect(() => verifyReleaseEnvironment(entries)).not.toThrow();
  expect(() =>
    verifyReleaseDeployment(
      { projectId: 'prj_PRISM', target: 'preview', readyState: 'READY' },
      'prj_PRISM',
    ),
  ).toThrow();
  expect(() =>
    verifyReleaseDeployment(
      { projectId: 'prj_OTHER', target: 'production', readyState: 'READY' },
      'prj_PRISM',
    ),
  ).toThrow();
  expect(() =>
    verifyReleaseDeployment(
      { projectId: 'prj_PRISM', target: 'production', readyState: 'READY' },
      'prj_PRISM',
    ),
  ).not.toThrow();
});
