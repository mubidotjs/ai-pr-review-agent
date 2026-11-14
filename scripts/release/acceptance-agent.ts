// Included only in the temporary acceptance artifact, never the production build.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createNodeHandler } from '../../src/server/node-adapter';
import { releaseConfig } from '../../src/server/release/environment';
import { ReleaseAccess, releaseFailure } from '../../src/server/release/access';
import { runAgentReview } from '../../src/server/agent/engine';
import { WorkersProposalAdapter } from '../../src/server/agent/proposal-adapter';
import { humanApprovalGate } from '../../src/server/agent/result';
import { fixtureTransport, PR_URL } from '../../tests/upstream-fixtures';
import { isEmptyRequest } from './empty-body';
let handler: ReturnType<typeof createNodeHandler> | undefined;
export default async function acceptanceAgent(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const secret = process.env.PRISM_TRANSPORT_SECRET ?? '',
    supplied = req.headers['x-prism-probe'];
  const expires = Number(process.env.PRISM_PROBE_EXPIRES);
  if (
    !/^[a-f0-9]{64}$/.test(secret) ||
    typeof supplied !== 'string' ||
    !/^[a-f0-9]{64}$/.test(supplied) ||
    supplied.length !== secret.length ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied)) ||
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    expires > Date.now() + 3600000
  ) {
    res.writeHead(401, { 'Cache-Control': 'no-store', Connection: 'close' });
    res.end();
    return;
  }
  if (!handler) {
    const config = releaseConfig();
    handler = createNodeHandler(
      async (request) => {
        if (
          request.method !== 'POST' ||
          new URL(request.url).pathname !== '/api/acceptance-agent' ||
          new URL(request.url).search ||
          request.headers.has('Origin')
        )
          return Response.json(
            { error: { code: 'REJECTED_ROUTE' } },
            { status: 404 },
          );
        let grant: string | undefined;
        try {
          if (!(await isEmptyRequest(request)))
            return Response.json(
              { error: { code: 'EMPTY_BODY_REQUIRED' } },
              { status: 400 },
            );
          const principal = new ReleaseAccess(config).principal(request);
          ({ grant } = await config.relay.call<{ grant: string }>(
            '/admit',
            { principal, kind: 'agent' },
            request.signal,
          ));
          const { result } = await runAgentReview(
            { url: PR_URL },
            {
              model: new WorkersProposalAdapter(config.relay, grant),
              allowRealModel: true,
              transport: fixtureTransport(),
              signal: request.signal,
            },
          );
          result.limitations.unshift(
            'SYNTHETIC ACCEPTANCE FIXTURE: GitHub responses and source links are fictional. Model decisions use the real native binding only when separately authorized.',
          );
          const approval = humanApprovalGate(result);
          if (result.findings.length)
            await config.relay.call(
              '/draft',
              {
                principal,
                runId: result.runId,
                digest: approval.digest,
                result,
              },
              request.signal,
            );
          return Response.json({
            synthetic: true,
            result,
            digest: approval.digest,
          });
        } catch (error) {
          return releaseFailure(error);
        } finally {
          if (grant)
            await config.relay.call('/finish', { grant }).catch(() => {});
        }
      },
      { origin: `https://${process.env.VERCEL_URL}` },
    );
  }
  await handler(req, res);
}
