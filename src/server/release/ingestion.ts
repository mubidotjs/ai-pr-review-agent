import { createApp } from '../index';
import type { Transport } from '../github';
import {
  ReleaseAccess,
  guardRequest,
  releaseFailure,
  type AccessConfig,
} from './access';
import { safeJson, ReleaseError } from '../../release/contract';
export function createReleaseIngestion(
  config: AccessConfig,
  transport?: Transport,
) {
  const access = new ReleaseAccess(config),
    app = createApp(transport, 'node');
  return async (request: Request): Promise<Response> => {
    let grant: string | undefined;
    try {
      guardRequest(request);
      const path = new URL(request.url).pathname;
      if (path === '/api/session') return await access.session(request);
      if (path === '/api/health' && request.method === 'GET')
        return safeJson({
          status: 'ok',
          runtime: 'node',
          ai: 'access-controlled',
        });
      const principal = access.principal(request);
      if (path !== '/api/review' || request.method !== 'POST')
        throw new ReleaseError('NOT_FOUND', 404);
      ({ grant } = await config.relay.call<{ grant: string }>(
        '/admit',
        { principal, kind: 'deterministic' },
        request.signal,
      ));
      return await app.fetch(request);
    } catch (error) {
      return releaseFailure(error);
    } finally {
      // Admission covers GitHub capture; streaming has its separate existing deadline.
      if (grant) await config.relay.call('/finish', { grant }).catch(() => {});
    }
  };
}
