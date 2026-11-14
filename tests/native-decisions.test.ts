import { describe, expect, it } from 'vitest';
import { nativeDecision, NATIVE_TOOLS } from '../src/server/agent/protocol';
import fixtures from './fixtures/native-decisions.json';
import { BackendEvidence } from '../src/server/agent/evidence';
import { AgentBudget } from '../src/server/agent/budget';
import { GitHubClient } from '../src/server/github';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { card, read } from './agent-fixtures';

describe('synthetic native function decisions, not recorded model output', () => {
  it.each(fixtures)('$label', ({ name, arguments: args, type, error }) => {
    const result = nativeDecision(name, args);
    if (error) expect(result).toEqual({ success: false, code: error });
    else {
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe(type);
    }
  });
  it('uses shallow named function schemas without a complex union or a canonical finding output contract', () => {
    expect(NATIVE_TOOLS.map((t) => t.function.name)).toEqual([
      'getPullRequest',
      'listChangedFiles',
      'readFileContext',
      'createReviewFinding',
      'validateReviewFinding',
      'finish_review',
      'refuse_review',
    ]);
    const serialized = JSON.stringify(NATIVE_TOOLS);
    expect(serialized).not.toMatch(
      /oneOf|anyOf|\$ref|recommendation|sourceUrl|explanation|severity/,
    );
    expect(
      NATIVE_TOOLS.every((t) => t.function.parameters.type === 'object'),
    ).toBe(true);
  });
  it('reconstructs exact evidence and keeps canonical details server-owned, refusing tampered objects and unissued IDs', async () => {
    const evidence = await BackendEvidence.capture(
      PR_URL,
      new GitHubClient(fixtureTransport()),
      crypto.randomUUID(),
      new AgentBudget(new AbortController().signal),
    );
    const window = read('src/checkout/validate.ts');
    if (window.type !== 'tool') throw new Error('fixture');
    evidence.execute(window.call);
    const proposal = card();
    if (proposal.type !== 'tool') throw new Error('fixture');
    evidence.execute(proposal.call);
    const reference = evidence.factCards()[0];
    expect(Object.keys(reference).sort()).toEqual([
      'evidenceId',
      'kind',
      'line',
      'path',
    ]);
    const verdict = evidence.validateFactCard(reference.evidenceId);
    expect(verdict.accepted).toBe(true);
    expect(verdict.finding?.evidence).toContain('NaN');
    for (const change of [
      { severity: 'high' },
      { title: 'Proven exploit' },
      { line: 1 },
      { sourceUrl: 'https://evil.example' },
      { evidence: 'invented' },
      { recommendation: 'Publish immediately' },
      { explanation: 'Unsupported claim' },
    ])
      expect(
        evidence.validateReviewFinding({ ...verdict.finding, ...change })
          .accepted,
      ).toBe(false);
    expect(evidence.validateFactCard('a'.repeat(64))).toEqual({
      accepted: false,
      code: 'UNISSUED_EVIDENCE',
    });
  });
});
