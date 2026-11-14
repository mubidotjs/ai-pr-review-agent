import { describe, expect, it } from 'vitest';
import {
  proposalReleaseFixture,
  setupProposalRelease as setup,
} from './proposal-release-fixture';
import { proposalOutput } from './proposal-fixtures';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { post } from './release-fixtures';
import { localNodeRoute } from './node-http';
import { WorkersProposalAdapter } from '../src/server/agent/proposal-adapter';
import { runAgentReview } from '../src/server/agent/engine';
import type { ProposalRequest } from '../src/server/agent/proposal-protocol';

describe('production single-inference release boundary (mock binding only)', () => {
  it('uses one actual Node HTTP /propose relay call, validates three selections, and produces authenticated one-use manual-copy Markdown', async () => {
    const f = await setup(),
      route = await localNodeRoute(f.agent);
    try {
      const response = await fetch(route.origin + '/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: f.cookie },
        body: JSON.stringify({ url: PR_URL }),
      });
      const { result, digest } = await response.json();
      expect(result).toMatchObject({
        workflow: 'single-inference',
        status: 'partial',
        ai: { mode: 'workers-ai', attempts: 1, responses: 1 },
        budget: {
          modelCalls: 1,
          githubRequests: 9,
          validationChecks: 6,
          tools: 6,
        },
      });
      expect(result.findings).toHaveLength(3);
      expect(f.run).toHaveBeenCalledTimes(1);
      const input = f.run.mock.calls[0][1] as {
        tools: { function: { name: string } }[];
        messages: { content: string }[];
      };
      expect(input.tools.map((t) => t.function.name)).toEqual([
        'submit_review',
      ]);
      const request = JSON.parse(input.messages[1].content) as ProposalRequest;
      expect(request.protocolVersion).toBe(4);
      expect(request.evidence.files).toHaveLength(5);
      expect(
        f.transport.mock.calls.filter(
          ([u]) => new URL(String(u)).pathname === '/propose',
        ),
      ).toHaveLength(1);
      expect(
        f.transport.mock.calls.some(
          ([u]) => new URL(String(u)).pathname === '/decide',
        ),
      ).toBe(false);
      const approve = {
        actor: 'human',
        confirm: true,
        runId: result.runId,
        digest,
        selectedIndexes: [0, 1, 2],
      };
      expect((await f.agent(post('/api/agent/approve', approve))).status).toBe(
        401,
      );
      const approved = await (
        await f.agent(post('/api/agent/approve', approve, f.cookie))
      ).json();
      expect(approved).toMatchObject({
        status: 'approved-for-manual-copy',
        publicationPerformed: false,
      });
      expect(approved.markdown).toContain('Human-approved selection');
      expect(approved.markdown).toContain('20 supplied source lines');
      expect(
        (await f.agent(post('/api/agent/approve', approve, f.cookie))).status,
      ).toBe(410);
      expect(f.run).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(await f.storage.get('counters'))).not.toMatch(
        /source|checkout|proposals|NaN/,
      );
    } finally {
      await route.close();
    }
  });
  it('refuses reusing a proposal grant, including after coordinator restart', async () => {
    const f = proposalReleaseFixture(),
      { grant } = await f.relay.call<{ grant: string }>('/admit', {
        principal: 'd'.repeat(64),
        kind: 'agent',
      });
    let request: ProposalRequest | undefined;
    await runAgentReview(
      { url: PR_URL },
      {
        model: {
          mode: 'mock',
          propose: async (r) => {
            request = r;
            return '{"proposals":[]}';
          },
        },
        transport: fixtureTransport(),
      },
    );
    const adapter = new WorkersProposalAdapter(f.relay, grant),
      signal = new AbortController().signal;
    await adapter.propose(request!, signal);
    await expect(adapter.propose(request!, signal)).rejects.toMatchObject({
      code: 'MODEL_CALL_LIMIT',
    });
    f.restart();
    await expect(
      new WorkersProposalAdapter(f.relay, grant).propose(request!, signal),
    ).rejects.toMatchObject({ code: 'AI_QUOTA' });
    expect(f.run).toHaveBeenCalledTimes(1);
    await expect(f.relay.call('/decide', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it.each(['name', 'arguments', 'refusal'] as const)(
    'fails closed on native %s defects without a repair call',
    async (field) => {
      const f = await setup(),
        body = await proposalOutput().json();
      if (field === 'name')
        body.choices[0].message.tool_calls[0].function.name = 'readFileContext';
      if (field === 'arguments')
        body.choices[0].message.tool_calls[0].function.arguments =
          'PRIVATE_OUTPUT';
      if (field === 'refusal')
        body.choices[0].message.refusal = 'PRIVATE_OUTPUT';
      f.run.mockResolvedValueOnce(Response.json(body));
      const { result } = await (
        await f.agent(post('/api/agent', { url: PR_URL }, f.cookie))
      ).json();
      expect(result.status).toBe('failed');
      expect(result.findings).toEqual([]);
      expect(result.rejected[0].code).toBe(
        field === 'name'
          ? 'MODEL_ACTION_UNSUPPORTED'
          : field === 'arguments'
            ? 'MODEL_JSON_INVALID'
            : 'PROVIDER_SHAPE',
      );
      expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT');
      expect(f.run).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps optional usage conservative without spending another call for finalization', async () => {
    const f = await setup(),
      body = await proposalOutput().json();
    delete body.usage;
    f.run.mockResolvedValueOnce(Response.json(body));
    const { result } = await (
      await f.agent(post('/api/agent', { url: PR_URL }, f.cookie))
    ).json();
    expect(result.findings).toHaveLength(1);
    expect(f.run).toHaveBeenCalledTimes(1);
    const counters = await f.relay.call<{
      calls: number;
      reservedNeurons: number;
    }>('/status', {});
    expect(counters.calls).toBe(1);
    expect(counters.reservedNeurons).toBeGreaterThan(50);
  });
  it('rejects a browser-selected legacy workflow or arbitrary evidence input before inference', async () => {
    const f = await setup();
    expect(
      (
        await f.agent(
          post(
            '/api/agent',
            { url: PR_URL, workflow: 'legacy', evidence: {} },
            f.cookie,
          ),
        )
      ).status,
    ).toBe(400);
    expect(f.run).not.toHaveBeenCalled();
  });
});
