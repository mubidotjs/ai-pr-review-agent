import type {
  ProposalModelAdapter,
  ProposalRequest,
  ProposalResponse,
} from './proposal-protocol';
/** Offline transport fixture only, never a provider substitute in release configuration. */
export class MockProposalModel implements ProposalModelAdapter {
  readonly mode = 'mock' as const;
  constructor(
    private response:
      | ProposalResponse
      | string
      | ((
          request: ProposalRequest,
        ) => ProposalResponse | string | Promise<ProposalResponse | string>),
  ) {}
  async propose(request: ProposalRequest, signal: AbortSignal) {
    if (signal.aborted) throw new Error('Cancelled');
    const value =
      typeof this.response === 'function'
        ? await this.response(request)
        : this.response;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
}
