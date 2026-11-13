import { AGENT_LIMITS, type AgentLimits } from './protocol';

export class AgentFailure extends Error {
  constructor(
    readonly code:
      | 'CANCELLED'
      | 'TIME_LIMIT'
      | 'STEP_LIMIT'
      | 'TOOL_LIMIT'
      | 'MODEL_CALL_LIMIT'
      | 'MODEL_INPUT_LIMIT'
      | 'MODEL_OUTPUT_LIMIT'
      | 'OBSERVATION_LIMIT'
      | 'VALIDATION_LIMIT'
      | 'RESULT_LIMIT'
      | 'MODEL_ERROR'
      | 'INVALID_MODEL_RESPONSE'
      | 'SNAPSHOT_UNVERIFIED'
      | 'CAPTURE_FAILED',
  ) {
    super(code);
  }
}
export class AgentBudget {
  readonly limits: AgentLimits;
  steps = 0;
  toolCalls = 0;
  modelCalls = 0;
  observationBytes = 0;
  validationChecks = 0;
  readonly started = performance.now();
  constructor(
    readonly signal: AbortSignal,
    limits: Partial<AgentLimits> = {},
  ) {
    this.limits = { ...AGENT_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits))
      if (
        !Object.hasOwn(AGENT_LIMITS, key) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > AGENT_LIMITS[key as keyof AgentLimits]
      )
        throw new Error('Agent limits may only be reduced.');
    if (this.limits.resultBytes < 1024)
      throw new Error('The safe result envelope requires at least 1024 bytes.');
  }
  check() {
    if (this.signal.aborted) throw new AgentFailure('CANCELLED');
    if (performance.now() - this.started >= this.limits.durationMs)
      throw new AgentFailure('TIME_LIMIT');
  }
  step() {
    this.check();
    if (++this.steps > this.limits.steps) throw new AgentFailure('STEP_LIMIT');
  }
  tool() {
    this.check();
    if (++this.toolCalls > this.limits.toolCalls)
      throw new AgentFailure('TOOL_LIMIT');
  }
  model() {
    this.check();
    if (++this.modelCalls > this.limits.modelCalls)
      throw new AgentFailure('MODEL_CALL_LIMIT');
  }
  validate() {
    this.check();
    if (++this.validationChecks > this.limits.validationChecks)
      throw new AgentFailure('VALIDATION_LIMIT');
  }
  async wait<T>(pending: Promise<T>): Promise<T> {
    this.check();
    let abort: () => void = () => {};
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          abort = () => reject(new AgentFailure('CANCELLED'));
          this.signal.addEventListener('abort', abort, { once: true });
          if (this.signal.aborted) abort();
        }),
      ]);
    } finally {
      this.signal.removeEventListener('abort', abort);
    }
  }
}
