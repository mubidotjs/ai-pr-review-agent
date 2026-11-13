export const REQUIRED_RELEASE_ENV = [
  'PRISM_PUBLIC_ORIGIN',
  'PRISM_AI_ORIGIN',
  'PRISM_ACCESS_CODE',
  'PRISM_SESSION_SECRET',
  'PRISM_RELAY_SECRET',
] as const;
/** Check metadata, never secret values. First deployments can become Production. */
export function verifyReleaseEnvironment(
  entries: { key: string; target: string[] }[],
) {
  for (const key of REQUIRED_RELEASE_ENV)
    for (const target of ['preview', 'production']) {
      if (
        !entries.some(
          (entry) => entry.key === key && entry.target.includes(target),
        )
      )
        throw new Error(`Missing ${key} in ${target}; do not deploy.`);
    }
}
export function verifyReleaseDeployment(
  value: { target?: string | null; readyState?: string; projectId?: string },
  projectId: string,
) {
  if (
    !/^prj_[A-Za-z0-9]+$/.test(projectId) ||
    value.projectId !== projectId ||
    value.target !== 'production' ||
    value.readyState !== 'READY'
  )
    throw new Error(
      'Unexpected release deployment identity or target; stop before requests.',
    );
}
