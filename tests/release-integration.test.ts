import { describe, expect, it } from 'vitest';
import { createReleaseIngestion } from '../src/server/release/ingestion';
import { createReleaseAgent } from './legacy-release';
import { releaseFixture, post, SERVER_SECRET } from './release-fixtures';
import { fixtureTransport, PR_URL } from './upstream-fixtures';
import { RELEASE } from '../src/release/contract';
import { localNodeRoute } from './node-http';
import type { AgentResult } from '../src/server/agent/result';
import { fullInvestigationModel } from './agent-fixtures';
import baseline from './baseline-demo.json';

async function setup(script?: ReturnType<typeof fullInvestigationModel>) {
  const f = releaseFixture(script),
    ingestion = createReleaseIngestion(f.config, fixtureTransport()),
    agent = createReleaseAgent(f.config, { transport: fixtureTransport() });
  const login = await ingestion(
    post('/api/session', { code: f.config.accessCode }),
  );
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  return { ...f, ingestion, agent, cookie };
}
describe('release integration with synthetic binding responses only', () => {
  it('retains all three canonical findings and false-positive refusals through the integrated adapter', async () => {
    const f = await setup(fullInvestigationModel());
    const { result } = (await (
      await f.agent(post('/api/agent', { url: PR_URL }, f.cookie))
    ).json()) as { result: AgentResult };
    expect(
      result.findings.map((finding) => ({
        path: finding.path,
        line: finding.line,
        sourceUrl: finding.sourceUrl,
        severity: finding.severity,
      })),
    ).toEqual(
      baseline.findings.map((finding) => ({
        path: finding.path,
        line: finding.line,
        sourceUrl: finding.sourceUrl,
        severity: finding.severity,
      })),
    );
    expect(
      result.rejected.filter((r) => r.code === 'CLAIM_NOT_SUPPORTED'),
    ).toHaveLength(2);
    expect(result.coverage).toMatchObject({
      total: 8,
      inspected: 5,
      semanticChecksCompleted: 5,
    });
    expect(f.run).toHaveBeenCalledTimes(13);
  });
  it('requires server access, enforces origin and returns no-store secure sessions', async () => {
    const f = await setup();
    const unauth = await f.agent(post('/api/agent', { url: PR_URL }));
    expect(unauth.status).toBe(401);
    expect(f.run).not.toHaveBeenCalled();
    const login = await f.ingestion(
      post('/api/session', { code: f.config.accessCode }),
    );
    expect(login.headers.get('set-cookie')).toMatch(
      /HttpOnly; Secure; SameSite=Strict; Path=\/api/,
    );
    expect(login.headers.get('cache-control')).toBe('no-store');
    const cross = post('/api/agent', { url: PR_URL }, f.cookie);
    cross.headers.set('Origin', 'https://evil.example');
    expect((await f.agent(cross)).status).toBe(403);
    expect(
      (await f.agent(post('/api/agent', { url: PR_URL }, f.cookie + 'broken')))
        .status,
    ).toBe(401);
  });
  it('preserves finding parity through relay, strict native shape and backend approval', async () => {
    const f = await setup();
    const response = await f.agent(
      post('/api/agent', { url: PR_URL }, f.cookie),
    );
    expect(response.status).toBe(200);
    const { result, digest } = (await response.json()) as {
      result: AgentResult;
      digest: string;
    };
    // These are mocked native responses; tests do not establish production inference.
    expect(result.ai).toEqual({
      mode: 'workers-ai',
      realInference: true,
      attempts: 3,
      responses: 3,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      kind: 'nan-comparison',
      path: 'src/checkout/validate.ts',
      line: 2,
      source: 'workers-ai',
      evidenceValidation: 'backend-pinned-supported-predicate',
    });
    expect(result.budget.githubRequests).toBe(9);
    expect(result.coverage).toMatchObject({
      total: 8,
      inventoried: 8,
      inspected: 1,
      semanticChecksCompleted: 1,
    });
    expect(f.run).toHaveBeenCalledTimes(3);
    expect(f.run.mock.calls[0][0]).toBe(RELEASE.model);
    expect(f.run.mock.calls[0][1]).toMatchObject({
      stream: false,
      n: 1,
      max_completion_tokens: 2048,
      chat_template_kwargs: { enable_thinking: false },
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
    expect(f.run.mock.calls[0][1]).not.toHaveProperty('response_format');
    const body = {
      actor: 'human',
      confirm: true,
      runId: result.runId,
      digest,
      selectedIndexes: [0],
    };
    const approved = await f.agent(post('/api/agent/approve', body, f.cookie));
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      publicationPerformed: false,
      status: 'approved-for-manual-copy',
      markdown: expect.stringContaining('Native Workers AI'),
    });
    expect(
      (await f.agent(post('/api/agent/approve', body, f.cookie))).status,
    ).toBe(410);
    expect(JSON.stringify(await f.storage.get('counters'))).not.toMatch(
      /checkout|sourceUrl|evidence|PRISM bounded/,
    );
  });
  it('refuses malformed decisions without retry, hides provider exceptions and reserves unknown usage', async () => {
    const f = await setup();
    f.run.mockResolvedValueOnce(
      Response.json({
        object: 'chat.completion',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: '{"type":"publish","token":"SECRET"}',
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }),
    );
    const response = await f.agent(
      post('/api/agent', { url: PR_URL }, f.cookie),
    );
    const { result } = await response.json();
    expect(result.findings).toEqual([]);
    expect(result.ai.realInference).toBe(false);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    const quota = await f.relay.call<{
      calls: number;
      reservedNeurons: number;
    }>('/status', {});
    expect(quota.calls).toBe(1);
    expect(quota.reservedNeurons).toBeGreaterThan(50);
  });
  it('approval fails on draft eviction and never accepts browser-computed findings', async () => {
    const f = await setup();
    const { result, digest } = await (
      await f.agent(post('/api/agent', { url: PR_URL }, f.cookie))
    ).json();
    expect(
      (
        await f.agent(
          post(
            '/api/agent/approve',
            {
              actor: 'human',
              confirm: true,
              runId: result.runId,
              digest,
              selectedIndexes: [0],
              findings: result.findings,
            },
            f.cookie,
          ),
        )
      ).status,
    ).toBe(400);
    f.restart();
    expect(
      (
        await f.agent(
          post(
            '/api/agent/approve',
            {
              actor: 'human',
              confirm: true,
              runId: result.runId,
              digest,
              selectedIndexes: [0],
            },
            f.cookie,
          ),
        )
      ).status,
    ).toBe(410);
  });
  it('authenticates a real local Node HTTP route and cancels an in-flight binding without retry', async () => {
    const f = await setup();
    f.run.mockImplementationOnce(async () => new Promise(() => {}));
    const node = await localNodeRoute(f.agent);
    const abort = new AbortController();
    try {
      const request = fetch(node.origin + '/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: f.cookie },
        body: JSON.stringify({ url: PR_URL }),
        signal: abort.signal,
      });
      await new Promise<void>((resolve) => {
        const check = () => {
          if (f.run.mock.calls.length) resolve();
          else setTimeout(check, 5);
        };
        check();
      });
      abort.abort();
      await expect(request).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(f.run).toHaveBeenCalledTimes(1);
    } finally {
      await node.close();
    }
  });
  it('never dispatches inference from deterministic ingestion and enforces the shared review ceiling', async () => {
    const f = await setup();
    for (let i = 0; i < 4; i++) {
      const response = await f.ingestion(
        post('/api/review', { url: PR_URL }, f.cookie),
      );
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    expect(
      (await f.ingestion(post('/api/review', { url: PR_URL }, f.cookie)))
        .status,
    ).toBe(429);
    expect(f.run).not.toHaveBeenCalled();
    expect(
      (
        await f.ingestion(
          post(
            '/api/review',
            { url: PR_URL },
            'prism_session=' + SERVER_SECRET,
          ),
        )
      ).status,
    ).toBe(401);
  });
});
