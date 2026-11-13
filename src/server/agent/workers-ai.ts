import { z } from 'zod';
import {
  decisionSchema,
  type AgentModelAdapter,
  type ModelRequest,
} from './protocol';
import { AgentFailure } from './budget';
import type { Relay } from '../release/relay';
import { ReleaseError } from '../../release/contract';
export class WorkersAiAdapter implements AgentModelAdapter {
  readonly mode = 'workers-ai' as const;
  private attempts = 0;
  private responses = 0;
  constructor(
    private relay: Relay,
    private grant: string,
  ) {}
  diagnostics() {
    return { attempts: this.attempts, responses: this.responses };
  }
  async next(request: ModelRequest, signal: AbortSignal): Promise<string> {
    const turn = this.attempts++;
    let response: unknown;
    try {
      response = await this.relay.call(
        '/decide',
        { grant: this.grant, turn, request },
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw new AgentFailure('CANCELLED');
      if (
        (error instanceof ReleaseError && error.code === 'TIMEOUT') ||
        (error instanceof Error &&
          ['AbortError', 'TimeoutError'].includes(error.name))
      )
        throw new AgentFailure('PROVIDER_TIMEOUT');
      if (
        error instanceof ReleaseError &&
        [
          'AI_QUOTA',
          'PROVIDER_TIMEOUT',
          'PROVIDER_QUOTA',
          'PROVIDER_ERROR',
          'PROVIDER_SHAPE',
        ].includes(error.code)
      )
        throw new AgentFailure(
          error.code as
            | 'AI_QUOTA'
            | 'PROVIDER_TIMEOUT'
            | 'PROVIDER_QUOTA'
            | 'PROVIDER_ERROR'
            | 'PROVIDER_SHAPE',
        );
      throw new AgentFailure('MODEL_ERROR');
    }
    const parsed = z
      .object({ decision: decisionSchema, bindingResponse: z.literal(true) })
      .strict()
      .safeParse(response);
    if (!parsed.success) throw new AgentFailure('INVALID_MODEL_RESPONSE');
    this.responses++;
    return JSON.stringify(parsed.data.decision);
  }
}
