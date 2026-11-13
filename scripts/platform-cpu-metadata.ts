export const CPU_WORKER_NAME = 'prism-m25-cpu-verification-20261113';

export function permittedPlatformRequest(
  account: string,
  path: string,
  method: string,
): boolean {
  const root = `/accounts/${account}/workers`;
  const script = `${root}/scripts/${CPU_WORKER_NAME}`;
  if (path === '/graphql') return method === 'POST';
  if (
    [
      `${root}/subdomain`,
      `${root}/account-settings`,
      `${script}/settings`,
    ].includes(path)
  )
    return method === 'GET';
  if (path === script) return method === 'PUT' || method === 'DELETE';
  return path === `${script}/subdomain` && method === 'POST';
}

export interface CpuMetric {
  datetime: string;
  status: string;
  requests: number;
  errors: number;
  cpuTimeP50: number;
  cpuTimeP95: number;
  cpuTimeP99: number;
  wallTimeP50: number;
  wallTimeP99: number;
  startupCpuTimeUsP99: number;
}
export function safeMetrics(value: unknown): CpuMetric[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error('Invalid metric count');
  return value.map((row) => {
    const { dimensions: d, sum: s, quantiles: q } = row;
    if (
      !d ||
      !s ||
      !q ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(d.datetime) ||
      ![
        'success',
        'clientDisconnected',
        'scriptThrewException',
        'exceededResources',
        'internalError',
      ].includes(d.status)
    )
      throw new Error('Invalid metric dimensions');
    const result = {
      datetime: d.datetime,
      status: d.status,
      requests: s.requests,
      errors: s.errors,
      cpuTimeP50: q.cpuTimeP50,
      cpuTimeP95: q.cpuTimeP95,
      cpuTimeP99: q.cpuTimeP99,
      wallTimeP50: q.wallTimeP50,
      wallTimeP99: q.wallTimeP99,
      startupCpuTimeUsP99: q.startupCpuTimeUsP99,
    };
    if (
      Object.entries(result).some(
        ([key, n]) =>
          !['datetime', 'status'].includes(key) &&
          (typeof n !== 'number' || !Number.isFinite(n) || n < 0),
      )
    )
      throw new Error('Invalid metric values');
    return result;
  });
}
