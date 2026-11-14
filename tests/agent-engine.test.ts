import { describe, expect, it, vi } from 'vitest';
import { runAgentReview } from '../src/server/agent/engine';
import { ScriptedMockModel } from '../src/server/agent/model';
import { humanApprovalGate } from '../src/server/agent/result';
import type {
  AgentModelAdapter,
  ModelRequest,
} from '../src/server/agent/protocol';
import { analyzeSnapshot } from '../src/analysis/review';
import { decodeSnapshotWire } from '../src/analysis/snapshot-wire';
import { createApp } from '../src/server/index';
import { fixtureTransport, PR_URL, HEAD, sources } from './upstream-fixtures';
import baseline from './baseline-demo.json';
import {
  fullInvestigationModel,
  oneFindingModel,
  tool,
  read,
  card,
  generate,
  altered,
} from './agent-fixtures';

const execute = (
  model = oneFindingModel(),
  options: Partial<Parameters<typeof runAgentReview>[1]> = {},
) =>
  runAgentReview(
    { url: PR_URL },
    { model, transport: fixtureTransport(), ...options },
  );
describe('local mock agent and backend evidence authority', () => {
  it('investigates with all five backend interfaces, refuses lookalikes and returns three supported mock drafts', async () => {
    const upstream = vi.fn(fixtureTransport());
    const { result, humanApproval } = await execute(fullInvestigationModel(), {
      transport: upstream,
    });
    expect(result.ai).toEqual({ mode: 'mock-only', realInference: false });
    expect(result.findings.map((f) => f.kind)).toEqual([
      'nan-comparison',
      'jwt-expiration-disabled',
      'tls-verification-disabled',
    ]);
    expect(
      result.findings.every(
        (f) =>
          f.source === 'mock-model' &&
          f.evidenceValidation === 'backend-pinned-supported-predicate',
      ),
    ).toBe(true);
    expect(result.findings.map((f) => f.sourceUrl)).toEqual(
      baseline.findings.map((f) => f.sourceUrl),
    );
    expect(result.coverage).toMatchObject({
      total: 8,
      inventoried: 8,
      sourceAvailable: 5,
      inspected: 5,
      semanticChecksCompleted: 5,
      uninspected: 3,
      uninventoried: 0,
    });
    expect(
      result.rejected.filter((r) => r.code === 'CLAIM_NOT_SUPPORTED'),
    ).toHaveLength(2);
    expect(result.status).toBe('partial');
    expect(result.budget.tools).toBe(12);
    expect(result.budget.steps).toBe(13);
    expect(result.budget.githubRequests).toBe(9);
    expect(upstream).toHaveBeenCalledTimes(9);
    expect(
      upstream.mock.calls.every(
        ([url, init]) =>
          url.startsWith('https://api.github.com/repos/') &&
          init.method === 'GET' &&
          init.redirect === 'manual',
      ),
    ).toBe(true);
    expect(result.trace.map((t) => t.stage)).toEqual(
      expect.arrayContaining([
        'investigate',
        'select-read-only-tool',
        'observe',
        'generate-findings',
        'validate',
        'finalize',
      ]),
    );
    expect(humanApproval.preview()).toContain('UNAPPROVED');
    expect(humanApproval.preview()).toContain('MOCK');
    expect(result.publication).toEqual({
      status: 'requires-human-approval',
      automaticPublication: false,
    });
  });

  it('independently validates again after the model validates an issued fact-card ID', async () => {
    const model = new ScriptedMockModel([
      read('src/checkout/validate.ts'),
      card(),
      (request) =>
        tool({
          name: 'validateReviewFinding',
          arguments: { evidenceId: request.factCards[0].evidenceId },
        }),
      generate,
    ]);
    const { result } = await execute(model);
    expect(result.findings).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(result.budget.validationChecks).toBe(3);
  });

  it('never creates mock findings merely because deterministic rules match', async () => {
    const { result } = await execute(
      new ScriptedMockModel([{ type: 'generate', findingIds: [] }]),
    );
    expect(result.findings).toEqual([]);
    expect(result.coverage?.inspected).toBe(0);
    expect(result.status).toBe('partial');
  });

  it('requires a source observation before issuing a fact card', async () => {
    const { result } = await execute(new ScriptedMockModel([card(), generate]));
    expect(result.findings).toEqual([]);
    expect(result.rejected).toContainEqual({ code: 'EVIDENCE_NOT_OBSERVED' });
  });

  it.each([
    { severity: 'high' as const },
    { line: 1 },
    { path: 'src/docs/example.ts' },
    { evidence: 'invented source' },
    { sourceUrl: 'https://evil.example/claim' },
    { recommendation: 'Disable authentication everywhere.' },
    { title: 'Proven exploit' },
  ])('independently refuses altered candidate fields: %j', async (change) => {
    const { result } = await execute(oneFindingModel(altered(change)));
    expect(result.findings).toEqual([]);
    expect(result.rejected.length).toBeGreaterThan(0);
  });

  it('refuses evidence IDs from a different run', async () => {
    const first = await execute();
    const candidate = first.result.findings[0];
    const {
      id: _id,
      source: _source,
      evidenceValidation: _validation,
      ...wire
    } = candidate;
    expect(_id && _source && _validation).toBeTruthy();
    const second = await execute(
      new ScriptedMockModel([
        read('src/checkout/validate.ts'),
        card(),
        { type: 'generate', findingIds: [wire.evidenceId] },
      ]),
    );
    expect(second.result.findings).toEqual([]);
    expect(second.result.rejected).toContainEqual({
      index: 0,
      code: 'UNISSUED_EVIDENCE',
    });
  });

  it('deduplicates identical final candidates', async () => {
    const { result } = await execute(
      oneFindingModel((request) => ({
        type: 'generate',
        findingIds: [
          request.factCards[0].evidenceId,
          request.factCards[0].evidenceId,
        ],
      })),
    );
    expect(result.findings).toHaveLength(1);
    expect(result.rejected).toContainEqual({
      index: 1,
      code: 'DUPLICATE_FINDING',
    });
  });

  it('requires a human selection bound to the canonical draft; caller mutations cannot change approved content', async () => {
    const { result, humanApproval } = await execute();
    const id = result.findings[0].id;
    result.findings[0].explanation = 'FORGED CLIENT ATTESTATION';
    const decision = {
      actor: 'human',
      confirm: true,
      runId: humanApproval.runId,
      digest: humanApproval.digest,
      selectedIds: [id],
    };
    expect(() =>
      humanApproval.approve({ ...decision, actor: 'model' }),
    ).toThrow();
    expect(() =>
      humanApproval.approve({ ...decision, digest: 'forged' }),
    ).toThrow();
    expect(() =>
      humanApproval.approve({ ...decision, selectedIds: ['unknown'] }),
    ).toThrow();
    const approved = humanApproval.approve(decision);
    expect(approved.publicationPerformed).toBe(false);
    expect(approved.status).toBe('approved-for-manual-copy');
    expect(approved.markdown).not.toContain('FORGED CLIENT ATTESTATION');
    expect(approved.markdown).toContain('Nothing has been published');
    expect(() => humanApproval.approve(decision)).toThrow();
  });

  it('expires local approval and bounds Markdown export', async () => {
    const { result } = await execute();
    let now = 0;
    const gate = humanApprovalGate(result, () => now);
    now = 300001;
    expect(() =>
      gate.approve({
        actor: 'human',
        confirm: true,
        runId: gate.runId,
        digest: gate.digest,
        selectedIds: [result.findings[0].id],
      }),
    ).toThrow();
    expect(() => humanApprovalGate(result, undefined, 10).preview()).toThrow(
      'byte budget',
    );
  });

  it('blocks disabled and future real adapters before any source or model request', async () => {
    for (const mode of ['disabled', 'workers-ai'] as const) {
      const next = vi.fn(),
        transport = vi.fn();
      const { result } = await runAgentReview(
        { url: PR_URL },
        { model: { mode, next }, transport },
      );
      expect(result.status).toBe('disabled');
      expect(next).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      expect(result.findings).toEqual([]);
    }
  });

  it('does not accept browser snapshots or findings as agent input', async () => {
    const model: AgentModelAdapter = { mode: 'mock', next: vi.fn() },
      transport = vi.fn();
    const { result } = await runAgentReview(
      {
        url: PR_URL,
        snapshot: baseline,
        findings: baseline.findings,
        serverAttested: true,
      },
      { model, transport },
    );
    expect(result.rejected).toContainEqual({ code: 'INVALID_AGENT_INPUT' });
    expect(transport).not.toHaveBeenCalled();
    expect(model.next).not.toHaveBeenCalled();
  });

  it('preserves the deterministic ingestion/decoder/UI contract and frozen finding parity', async () => {
    await execute();
    const app = createApp(fixtureTransport());
    const response = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: PR_URL }),
    });
    const deterministic = analyzeSnapshot(
      decodeSnapshotWire(await response.arrayBuffer()),
    );
    expect(deterministic.review.findings).toEqual(baseline.findings);
    expect(deterministic.review.coverage).toEqual(baseline.coverage);
    expect(deterministic.review.ai.status).toBe('disabled');
    expect(deterministic.review.provenance?.serverAttested).toBe(false);
    expect(deterministic.review.pr.headSha).toBe(HEAD);
    expect(sources['src/docs/example.ts']).toContain('SYSTEM:');
  });

  it('does not allow model mutations of request observations to alter backend authority', async () => {
    const model = new ScriptedMockModel([
      read('src/checkout/validate.ts'),
      (request: ModelRequest) => {
        expect(Object.isFrozen(request.untrusted.observations[0].data)).toBe(
          true,
        );
        const mutable = structuredClone(request);
        (
          mutable.untrusted.observations[0].data as {
            lines: { text: string }[];
          }
        ).lines[1].text = 'FORGED';
        return card();
      },
      generate,
    ]);
    const { result } = await execute(model);
    expect(result.findings[0].evidence).toBe(
      sources['src/checkout/validate.ts'].split('\n')[1],
    );
  });
});
