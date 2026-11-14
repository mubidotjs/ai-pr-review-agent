import { MockProposalModel } from '../src/server/agent/proposal-model';
import type { ProposalResponse } from '../src/server/agent/proposal-protocol';
export const supportedProposals: ProposalResponse = {
  proposals: [
    { kind: 'nan-comparison', path: 'src/checkout/validate.ts', line: 2 },
    { kind: 'jwt-expiration-disabled', path: 'src/auth/session.ts', line: 3 },
    {
      kind: 'tls-verification-disabled',
      path: 'src/network/receipts.ts',
      line: 3,
    },
  ],
};
export const oneProposal: ProposalResponse = {
  proposals: supportedProposals.proposals.slice(0, 1),
};
export const mockProposals = (response: ProposalResponse = oneProposal) =>
  new MockProposalModel(response);
export function proposalOutput(response: ProposalResponse = oneProposal) {
  return Response.json({
    object: 'chat.completion',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'synthetic-proposal-call',
              type: 'function',
              function: {
                name: 'submit_review',
                arguments: JSON.stringify(response),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 100 },
  });
}
