import { describe, expect, it } from 'vitest';
import { runAgentReview } from '../src/server/agent/legacy-engine';
import { ScriptedMockModel } from '../src/server/agent/model';
import { BackendEvidence } from '../src/server/agent/evidence';
import { AgentBudget } from '../src/server/agent/budget';
import { GitHubClient } from '../src/server/github';
import { fixtureTransport, PR_URL, addition } from './upstream-fixtures';
import { tool, read, card, generate } from './agent-fixtures';
import { releaseFixture, post, nativeOutput } from './release-fixtures';
import { createReleaseIngestion } from '../src/server/release/ingestion';
import { createReleaseAgent } from './legacy-release';
import type { AgentResult } from '../src/server/agent/result';
import { nativeToolsFor } from '../src/server/agent/protocol';

const inventory = tool({
  name: 'listChangedFiles',
  arguments: { offset: 0, count: 5 },
});
const metadata = tool({ name: 'getPullRequest', arguments: {} });
const execute = (steps: ConstructorParameters<typeof ScriptedMockModel>[0]) =>
  runAgentReview(
    { url: PR_URL },
    { model: new ScriptedMockModel(steps), transport: fixtureTransport() },
  );

describe('backend-owned tool progress after the real inventory-loop failure', () => {
  it('offers source investigation after inventory and preserves canonical findings', async () => {
    const { result } = await execute([
      metadata,
      inventory,
      (request) => {
        expect(request.allowedTools).not.toContain('getPullRequest');
        expect(request.allowedTools).not.toContain('listChangedFiles');
        expect(request.allowedTools).toContain('readFileContext');
        const data = request.untrusted.observations.at(-1)!.data as {
          files: {
            path: string;
            sourceLineCount: number;
            firstAddedLine: number;
          }[];
        };
        const file = data.files.find(
          (file) => file.path === 'src/checkout/validate.ts',
        )!;
        expect(file.sourceLineCount).toBeGreaterThanOrEqual(
          file.firstAddedLine,
        );
        return tool({
          name: 'readFileContext',
          arguments: {
            path: file.path,
            startLine: file.firstAddedLine,
            endLine: Math.min(file.sourceLineCount, file.firstAddedLine + 79),
          },
        });
      },
      card(),
      generate,
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'nan-comparison',
      line: 2,
      evidenceValidation: 'backend-pinned-supported-predicate',
    });
    expect(result.budget).toMatchObject({
      tools: 4,
      modelCalls: 5,
      githubRequests: 9,
    });
    expect(result.coverage).toMatchObject({
      total: 8,
      inventoried: 8,
      sourceAvailable: 5,
      inspected: 1,
    });
  });
  it('stops an identical inventory request explicitly instead of spending all twelve tool calls', async () => {
    const { result } = await execute([metadata, inventory, inventory]);
    expect(result.rejected).toEqual([{ code: 'TOOL_NO_PROGRESS' }]);
    expect(result.budget).toMatchObject({ tools: 2, modelCalls: 3 });
    expect(result.findings).toEqual([]);
  });
  it('normalizes object key order before rejecting repeated tool arguments', async () => {
    const first = read('src/checkout/validate.ts');
    if (first.type !== 'tool' || first.call.name !== 'readFileContext')
      throw new Error('fixture');
    const { path, startLine, endLine } = first.call.arguments;
    const { result } = await execute([
      first,
      JSON.stringify({
        call: {
          arguments: { endLine, path, startLine },
          name: 'readFileContext',
        },
        type: 'tool',
      }),
    ]);
    expect(result.rejected).toEqual([{ code: 'TOOL_NO_PROGRESS' }]);
    expect(result.budget.tools).toBe(1);
  });
  it('allows the same hypothesis after newly observed source evidence makes it verifiable', async () => {
    const { result } = await execute([
      card(),
      read('src/checkout/validate.ts'),
      card(),
      generate,
    ]);
    expect(result.rejected).toEqual([{ code: 'EVIDENCE_NOT_OBSERVED' }]);
    expect(result.findings).toHaveLength(1);
    expect(result.budget.tools).toBe(3);
  });
  it('does not allow a different inventory request to bypass pending added-source investigation', async () => {
    const { result } = await execute([
      inventory,
      tool({ name: 'listChangedFiles', arguments: { offset: 5, count: 3 } }),
    ]);
    expect(result.rejected).toEqual([{ code: 'MODEL_ACTION_UNSUPPORTED' }]);
    expect(result.budget.tools).toBe(1);
    expect(result.findings).toEqual([]);
  });
  it('keeps inventory pending after unchanged context, then allows later pages after real added lines are inspected', async () => {
    const path = 'src/checkout/validate.ts',
      text = 'const value = 1;\nexport const bad = value === NaN;';
    const file = {
      ...addition(path, text),
      status: 'modified',
      additions: 1,
      patch:
        '@@ -1,1 +1,2 @@\n const value = 1;\n+export const bad = value === NaN;',
    };
    const evidence = await BackendEvidence.capture(
      PR_URL,
      new GitHubClient(
        fixtureTransport([file, addition('later.txt', 'text')], {
          [path]: text,
        }),
      ),
      crypto.randomUUID(),
      new AgentBudget(new AbortController().signal),
    );
    evidence.execute({
      name: 'listChangedFiles',
      arguments: { offset: 0, count: 1 },
    });
    evidence.execute({
      name: 'readFileContext',
      arguments: { path: 'src/checkout/validate.ts', startLine: 1, endLine: 1 },
    });
    expect(evidence.allowedTools()).not.toContain('listChangedFiles');
    evidence.execute({
      name: 'readFileContext',
      arguments: { path: 'src/checkout/validate.ts', startLine: 2, endLine: 2 },
    });
    expect(evidence.allowedTools()).toContain('listChangedFiles');
  });
  it('offers only terminal native actions after the tool budget is used and can finalize validated IDs', async () => {
    const { result } = await runAgentReview(
      { url: PR_URL },
      {
        model: new ScriptedMockModel([
          read('src/checkout/validate.ts'),
          card(),
          (request) => {
            expect(request.allowedTools).toEqual([]);
            expect(
              nativeToolsFor(request.allowedTools).map((t) => t.function.name),
            ).toEqual(['finish_review', 'refuse_review']);
            return generate(request);
          },
        ]),
        transport: fixtureTransport(),
        limits: { toolCalls: 2 },
      },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.budget.tools).toBe(2);
    expect(result.rejected).toEqual([]);
  });
  it('does not strand pagination on binary or unavailable source files', async () => {
    const path = 'notes.txt';
    const evidence = await BackendEvidence.capture(
      PR_URL,
      new GitHubClient(
        fixtureTransport(
          [addition(path, 'text'), addition('later.txt', 'text')],
          {},
        ),
      ),
      crypto.randomUUID(),
      new AgentBudget(new AbortController().signal),
    );
    evidence.execute({
      name: 'listChangedFiles',
      arguments: { offset: 0, count: 1 },
    });
    expect(evidence.allowedTools()).toContain('listChangedFiles');
    evidence.execute({
      name: 'listChangedFiles',
      arguments: { offset: 1, count: 1 },
    });
    expect(evidence.allowedTools()).not.toContain('listChangedFiles');
  });
  it('always permits an honest empty finish without synthesizing deterministic matches', async () => {
    const { result } = await execute([
      inventory,
      { type: 'generate', findingIds: [] },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.coverage?.inspected).toBe(0);
  });
  it('encodes the current tool subset in the native binding and rejects a model selecting a removed tool', async () => {
    const f = releaseFixture(
      new ScriptedMockModel([
        inventory,
        read('src/checkout/validate.ts'),
        card(),
        generate,
      ]),
    );
    const ingestion = createReleaseIngestion(f.config, fixtureTransport());
    const login = await ingestion(
      post('/api/session', { code: f.config.accessCode }),
    );
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const agent = createReleaseAgent(f.config, {
      transport: fixtureTransport(),
    });
    const original = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (model, input) => {
      const names = (
        input as { tools: { function: { name: string } }[] }
      ).tools.map((t) => t.function.name);
      if (f.run.mock.calls.length === 2) {
        expect(names).not.toContain('listChangedFiles');
        expect(names).toContain('readFileContext');
        expect(names).toContain('finish_review');
        expect(names).toContain('refuse_review');
        return nativeOutput(inventory);
      }
      return original(model, input);
    });
    const response = await agent(post('/api/agent', { url: PR_URL }, cookie));
    const { result } = (await response.json()) as { result: AgentResult };
    expect(result.rejected).toEqual([{ code: 'MODEL_ACTION_UNSUPPORTED' }]);
    expect(result.ai).toMatchObject({ attempts: 2, responses: 1 });
    expect(result.findings).toEqual([]);
    expect(f.run).toHaveBeenCalledTimes(2);
  });
});
