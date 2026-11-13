import { z } from 'zod';
import { runAgentReview } from '../agent/engine';
import { humanApprovalGate, type AgentResult } from '../agent/result';
import { WorkersAiAdapter } from '../agent/workers-ai';
import type { AgentModelAdapter } from '../agent/protocol';
import type { Transport } from '../github';
import { parsePullRequestUrl } from '../security';
import {
  ReleaseAccess,
  guardRequest,
  releaseFailure,
  type AccessConfig,
} from './access';
import { ReleaseError, readJson, safeJson } from '../../release/contract';
export function createReleaseAgent(
  config: AccessConfig,
  dependencies: {
    transport?: Transport;
    model?: (grant: string) => AgentModelAdapter;
  } = {},
) {
  const access = new ReleaseAccess(config);
  return async (request: Request): Promise<Response> => {
    let grant: string | undefined;
    try {
      guardRequest(request);
      const principal = access.principal(request),
        path = new URL(request.url).pathname;
      if (request.method !== 'POST')
        throw new ReleaseError('METHOD_NOT_ALLOWED', 405);
      const body = await readJson(request, 2048, request.signal);
      if (path === '/api/agent/approve') {
        const input = z
          .object({
            actor: z.literal('human'),
            confirm: z.literal(true),
            runId: z.string().uuid(),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            selectedIndexes: z
              .array(z.number().int().min(0).max(99))
              .min(1)
              .max(100),
          })
          .strict()
          .parse(body);
        const canonical = await config.relay.call<{ result: AgentResult }>(
          '/approve',
          { principal, runId: input.runId, digest: input.digest },
          request.signal,
        );
        const approval = humanApprovalGate(canonical.result);
        if (approval.digest !== input.digest)
          throw new ReleaseError('DRAFT_INTEGRITY', 409);
        if (
          new Set(input.selectedIndexes).size !==
            input.selectedIndexes.length ||
          input.selectedIndexes.some((i) => !canonical.result.findings[i])
        )
          throw new ReleaseError('INVALID_SELECTION', 400);
        return safeJson(
          approval.approve({
            actor: input.actor,
            confirm: input.confirm,
            runId: input.runId,
            digest: input.digest,
            selectedIds: input.selectedIndexes.map(
              (i) => canonical.result.findings[i].id,
            ),
          }),
        );
      }
      if (path !== '/api/agent') throw new ReleaseError('NOT_FOUND', 404);
      // Validate URL/input before spending a shared admission; capture still validates independently.
      const input = z
        .object({ url: z.string().min(1).max(2048) })
        .strict()
        .parse(body);
      parsePullRequestUrl(input.url);
      ({ grant } = await config.relay.call<{ grant: string }>(
        '/admit',
        { principal, kind: 'agent' },
        request.signal,
      ));
      const model =
        dependencies.model?.(grant) ??
        new WorkersAiAdapter(config.relay, grant);
      const { result, humanApproval } = await runAgentReview(input, {
        model,
        allowRealModel: true,
        transport: dependencies.transport,
        signal: request.signal,
      });
      if (
        result.findings.length &&
        ['partial', 'draft'].includes(result.status)
      )
        await config.relay.call(
          '/draft',
          {
            principal,
            runId: result.runId,
            digest: humanApproval.digest,
            result,
          },
          request.signal,
        );
      return safeJson({ result, digest: humanApproval.digest });
    } catch (error) {
      return releaseFailure(error);
    } finally {
      if (grant) await config.relay.call('/finish', { grant }).catch(() => {});
    }
  };
}
