import type {
  AgentDecision,
  AgentModelAdapter,
  ModelRequest,
} from './protocol';

export type MockStep =
  | string
  | AgentDecision
  | ((
      request: ModelRequest,
    ) => string | AgentDecision | Promise<string | AgentDecision>);
/** Scripted transport simulator, not a language model or inference implementation. */
export class ScriptedMockModel implements AgentModelAdapter {
  readonly mode = 'mock' as const;
  private cursor = 0;
  constructor(private readonly steps: readonly MockStep[]) {}
  async next(request: ModelRequest, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error('Cancelled');
    const step = this.steps[this.cursor++];
    if (step === undefined)
      return JSON.stringify({
        type: 'refuse',
        reason: 'INSUFFICIENT_EVIDENCE',
      });
    const response = typeof step === 'function' ? await step(request) : step;
    return typeof response === 'string' ? response : JSON.stringify(response);
  }
}
