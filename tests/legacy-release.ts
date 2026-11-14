// Explicit historical regression seam. Production has no caller-selected workflow.
import { createReleaseAgent as production } from '../src/server/release/agent-app';
import { runAgentReview } from '../src/server/agent/legacy-engine';
import { WorkersAiAdapter } from '../src/server/agent/workers-ai';
import type { AgentModelAdapter } from '../src/server/agent/protocol';
import type { Transport } from '../src/server/github';
export function createReleaseAgent(
  config: Parameters<typeof production>[0],
  dependencies: {
    transport?: Transport;
    model?: (grant: string) => AgentModelAdapter;
  } = {},
) {
  return production(config, {
    transport: dependencies.transport,
    review: (input, { grant, signal }) =>
      runAgentReview(input, {
        model:
          dependencies.model?.(grant) ??
          new WorkersAiAdapter(config.relay, grant),
        allowRealModel: true,
        transport: dependencies.transport,
        signal,
      }),
  });
}
