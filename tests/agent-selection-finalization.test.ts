import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentReview } from '../src/server/agent/legacy-engine';
import { BackendEvidence } from '../src/server/agent/evidence';
import { ScriptedMockModel, type MockStep } from '../src/server/agent/model';
import type { AgentDecision, ModelRequest } from '../src/server/agent/protocol';
import { card, read, tool, hypothesis } from './agent-fixtures';
import { fixtureTransport, PR_URL, sources } from './upstream-fixtures';
import { releaseFixture, post } from './release-fixtures';
import { createReleaseIngestion } from '../src/server/release/ingestion';
import { createReleaseAgent } from './legacy-release';
import type { AgentResult } from '../src/server/agent/result';

const select = (request: ModelRequest): AgentDecision =>
  tool({
    name: 'validateReviewFinding',
    arguments: {
      evidenceId: request.factCards[0]?.evidenceId ?? 'f'.repeat(64),
    },
  });
const empty: AgentDecision = { type: 'generate', findingIds: [] };
const selectedSteps: MockStep[] = [
  read('src/checkout/validate.ts'),
  card(),
  select,
];
const execute = (
  steps: MockStep[] = selectedSteps,
  options: Partial<Parameters<typeof runAgentReview>[1]> = {},
) =>
  runAgentReview(
    { url: PR_URL },
    {
      model: new ScriptedMockModel(steps),
      transport: fixtureTransport(),
      ...options,
    },
  );
afterEach(() => vi.restoreAllMocks());

describe('intentional finalization after model-selected fact-card validation', () => {
  it('returns one independently revalidated partial draft without requesting another decision', async () => {
    const unexpected = vi.fn(() => {
      throw new Error('No extra model decision is allowed');
    });
    const { result, humanApproval } = await execute([
      ...selectedSteps,
      unexpected,
    ]);
    expect(unexpected).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'nan-comparison',
      path: 'src/checkout/validate.ts',
      line: 2,
      evidenceValidation: 'backend-pinned-supported-predicate',
    });
    expect(result.budget).toMatchObject({
      modelCalls: 3,
      tools: 3,
      validationChecks: 3,
      githubRequests: 9,
    });
    expect(result.coverage).toMatchObject({
      total: 8,
      inspected: 1,
      semanticChecksCompleted: 1,
      uninspected: 7,
    });
    expect(humanApproval.preview()).toContain('UNAPPROVED');
    expect(result.publication.automaticPublication).toBe(false);
  });
  it('includes only the explicitly selected card even when other valid cards were created', async () => {
    const { result } = await execute([
      read('src/checkout/validate.ts'),
      card(),
      read('src/auth/session.ts'),
      card(hypothesis('src/auth/session.ts', 3, 'jwt-expiration-disabled')),
      select,
    ]);
    expect(result.findings.map((f) => f.kind)).toEqual(['nan-comparison']);
    expect(result.budget.modelCalls).toBe(5);
  });
  it.each([
    { type: 'refuse', reason: 'INSUFFICIENT_EVIDENCE' } as AgentDecision,
    empty,
    'not JSON',
  ])(
    'does not promote a created card without a selected validated outcome: %j',
    async (final) => {
      const { result } = await execute([
        read('src/checkout/validate.ts'),
        card(),
        final,
      ]);
      expect(result.findings).toEqual([]);
    },
  );
  it('does not turn provider failure after card creation into success', async () => {
    const { result } = await execute([
      read('src/checkout/validate.ts'),
      card(),
      () => {
        throw new Error('provider error');
      },
    ]);
    expect(result.status).toBe('failed');
    expect(result.findings).toEqual([]);
  });
  it('refuses unissued selections and cannot approve nonexistent evidence', async () => {
    const { result, humanApproval } = await execute([
      tool({
        name: 'validateReviewFinding',
        arguments: { evidenceId: 'f'.repeat(64) },
      }),
      empty,
    ]);
    expect(result.rejected).toContainEqual({ code: 'UNISSUED_EVIDENCE' });
    expect(result.findings).toEqual([]);
    expect(() =>
      humanApproval.approve({
        actor: 'human',
        confirm: true,
        runId: humanApproval.runId,
        digest: humanApproval.digest,
        selectedIds: ['f'.repeat(64)],
      }),
    ).toThrow();
  });
  it('does not finalize rejected unsupported hypotheses', async () => {
    const { result } = await execute([
      read('src/docs/example.ts'),
      card(hypothesis('src/docs/example.ts', 2, 'jwt-expiration-disabled')),
      select,
      empty,
    ]);
    expect(result.rejected).toContainEqual({ code: 'CLAIM_NOT_SUPPORTED' });
    expect(result.findings).toEqual([]);
  });
  it('does not finalize when model-selected validation of an issued card is rejected', async () => {
    vi.spyOn(BackendEvidence.prototype, 'validateFactCard').mockReturnValueOnce(
      { accepted: false, code: 'NOT_AN_EXACT_ADDED_LINE' },
    );
    const { result } = await execute([...selectedSteps, empty]);
    expect(result.rejected).toContainEqual({ code: 'NOT_AN_EXACT_ADDED_LINE' });
    expect(result.budget.modelCalls).toBe(4); // Rejection still permits an explicit empty finish.
    expect(result.findings).toEqual([]);
  });
  it('keeps pinned-source/diff mismatches closed in the selection workflow', async () => {
    const changed = {
      ...sources,
      'src/checkout/validate.ts': sources['src/checkout/validate.ts'].replace(
        'return { valid: amount > 0 };',
        'return { valid: false };',
      ),
    };
    const { result } = await execute([...selectedSteps, empty], {
      transport: fixtureTransport(undefined, changed),
    });
    expect(result.rejected).toContainEqual({
      code: 'SEMANTIC_CONTEXT_UNAVAILABLE',
    });
    expect(result.findings).toEqual([]);
  });
  it('refuses a selected card if the independent final revalidation rejects it', async () => {
    const original = BackendEvidence.prototype.validateFactCard;
    vi.spyOn(BackendEvidence.prototype, 'validateFactCard')
      .mockImplementationOnce(function (this: BackendEvidence, id) {
        return original.call(this, id);
      })
      .mockReturnValueOnce({
        accepted: false,
        code: 'NOT_AN_EXACT_ADDED_LINE',
      });
    const { result } = await execute();
    expect(result.rejected).toContainEqual({
      index: 0,
      code: 'NOT_AN_EXACT_ADDED_LINE',
    });
    expect(result.findings).toEqual([]);
  });
  it.each(['cancel', 'timeout'] as const)(
    'checks %s after the final independent validation before accepting a finding',
    async (kind) => {
      const controller = new AbortController();
      const original = BackendEvidence.prototype.validateFactCard;
      let checks = 0;
      vi.spyOn(
        BackendEvidence.prototype,
        'validateFactCard',
      ).mockImplementation(function (this: BackendEvidence, id) {
        const verdict = original.call(this, id);
        if (++checks === 2) {
          if (kind === 'cancel') controller.abort();
          else
            vi.spyOn(performance, 'now').mockReturnValue(
              performance.now() + 1000,
            );
        }
        return verdict;
      });
      const { result } = await execute(undefined, {
        signal: controller.signal,
        limits: { durationMs: 500 },
      });
      expect(checks).toBe(2);
      expect(result.rejected).toContainEqual({
        code: kind === 'cancel' ? 'CANCELLED' : 'TIME_LIMIT',
      });
      expect(result.findings).toEqual([]);
    },
  );
  it('preserves validation and result-size budgets on the direct finalization path', async () => {
    for (const limits of [{ validationChecks: 2 }, { resultBytes: 1024 }]) {
      const { result } = await execute(undefined, { limits });
      expect(result.findings).toEqual([]);
      expect(result.rejected).toContainEqual({
        code:
          'validationChecks' in limits ? 'VALIDATION_LIMIT' : 'RESULT_LIMIT',
      });
    }
  });
  it('uses five native-style decisions and the authenticated one-use human-copy gate without dispatch six', async () => {
    const f = releaseFixture(
      new ScriptedMockModel([
        tool({ name: 'getPullRequest', arguments: {} }),
        tool({ name: 'listChangedFiles', arguments: { offset: 0, count: 5 } }),
        ...selectedSteps,
      ]),
    );
    const original = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (...args) => {
      if (f.run.mock.calls.length > 5)
        throw new Error('Sixth native dispatch must not happen');
      return original(...args);
    });
    const ingestion = createReleaseIngestion(f.config, fixtureTransport());
    const login = await ingestion(
      post('/api/session', { code: f.config.accessCode }),
    );
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const agent = createReleaseAgent(f.config, {
      transport: fixtureTransport(),
    });
    const response = await agent(post('/api/agent', { url: PR_URL }, cookie));
    const { result, digest } = (await response.json()) as {
      result: AgentResult;
      digest: string;
    };
    expect(result.ai).toMatchObject({ attempts: 5, responses: 5 }); // Synthetic binding responses, not live inference.
    expect(result.status).toBe('partial');
    expect(result.findings).toHaveLength(1);
    expect(result.budget.validationChecks).toBe(3);
    expect(f.run).toHaveBeenCalledTimes(5);
    const decision = {
      actor: 'human',
      confirm: true,
      runId: result.runId,
      digest,
      selectedIndexes: [0],
    };
    expect((await agent(post('/api/agent/approve', decision))).status).toBe(
      401,
    );
    const approved = await agent(post('/api/agent/approve', decision, cookie));
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: 'approved-for-manual-copy',
      publicationPerformed: false,
      markdown: expect.stringContaining('Human-approved selection'),
    });
    expect(
      (await agent(post('/api/agent/approve', decision, cookie))).status,
    ).toBe(410);
    expect(f.run).toHaveBeenCalledTimes(5);
  });
});
