import type {
  AgentDecision,
  Candidate,
  Hypothesis,
  ModelRequest,
  ToolCall,
} from '../src/server/agent/protocol';
import { ScriptedMockModel, type MockStep } from '../src/server/agent/model';
import { sources } from './upstream-fixtures';

export const tool = (call: ToolCall): AgentDecision => ({ type: 'tool', call });
export const read = (
  path: string,
  endLine = sources[path].split('\n').length,
) =>
  tool({ name: 'readFileContext', arguments: { path, startLine: 1, endLine } });
export const hypothesis = (
  path = 'src/checkout/validate.ts',
  line = 2,
  kind: Hypothesis['kind'] = 'nan-comparison',
): Hypothesis => ({
  kind,
  path,
  line,
  evidence: sources[path].split('\n')[line - 1],
});
export const card = (value = hypothesis()) =>
  tool({
    name: 'createReviewFinding',
    arguments: { kind: value.kind, path: value.path, line: value.line },
  });
export const generate = (request: ModelRequest): AgentDecision => ({
  type: 'generate',
  findingIds: request.factCards.map((c) => c.evidenceId),
});
export function oneFindingModel(final: MockStep = generate) {
  return new ScriptedMockModel([
    read('src/checkout/validate.ts'),
    card(),
    final,
  ]);
}
export function fullInvestigationModel() {
  return new ScriptedMockModel([
    tool({ name: 'getPullRequest', arguments: {} }),
    tool({ name: 'listChangedFiles', arguments: { offset: 0, count: 5 } }),
    read('src/checkout/validate.ts'),
    card(),
    read('src/auth/session.ts'),
    card(hypothesis('src/auth/session.ts', 3, 'jwt-expiration-disabled')),
    read('src/network/receipts.ts'),
    card(hypothesis('src/network/receipts.ts', 3, 'tls-verification-disabled')),
    read('src/docs/example.ts'),
    card(hypothesis('src/docs/example.ts', 2, 'jwt-expiration-disabled')),
    read('src/ui/format.ts'),
    card(hypothesis('src/ui/format.ts', 2)),
    generate,
  ]);
}
export const altered =
  (change: Partial<Candidate>) =>
  (request: ModelRequest): string =>
    JSON.stringify({
      type: 'generate',
      findings: [{ ...request.factCards[0], ...change }],
    });
