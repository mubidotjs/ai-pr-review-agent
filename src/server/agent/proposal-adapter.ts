import { z } from 'zod';
import { AgentFailure } from './budget';
import type { Relay } from '../release/relay';
import { ReleaseError } from '../../release/contract';
import { relayErrorCode } from '../../release/errors';
import {
  proposalsSchema,
  type ProposalRequest,
  type ProposalModelAdapter,
} from './proposal-protocol';

export class WorkersProposalAdapter implements ProposalModelAdapter {
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
  async propose(request: ProposalRequest, signal: AbortSignal) {
    if (this.attempts) throw new AgentFailure('MODEL_CALL_LIMIT');
    this.attempts++;
    let response: unknown;
    try {
      response = await this.relay.call(
        '/propose',
        { grant: this.grant, request },
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw new AgentFailure('CANCELLED');
      const code =
        error instanceof ReleaseError ? relayErrorCode(error.code) : undefined;
      if (code)
        throw new AgentFailure(
          code === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : code,
          error instanceof ReleaseError ? error.diagnostic : undefined,
        );
      throw new AgentFailure('MODEL_ERROR');
    }
    const parsed = z
      .object({ proposal: proposalsSchema, bindingResponse: z.literal(true) })
      .strict()
      .safeParse(response);
    if (!parsed.success) throw new AgentFailure('RELAY_RESPONSE_INVALID');
    this.responses++;
    return JSON.stringify(parsed.data.proposal);
  }
}
