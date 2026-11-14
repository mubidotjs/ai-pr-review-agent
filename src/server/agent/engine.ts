import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GitHubClient, type Transport } from '../github';
import { byteLength, parsePullRequestUrl, ReviewError } from '../security';
import { AgentBudget, AgentFailure } from './budget';
import { BackendEvidence } from './evidence';
import { AGENT_LIMITS, type AgentLimits } from './protocol';
import { parseProposals, type ProposalModelAdapter } from './proposal-protocol';
import {
  humanApprovalGate,
  type AgentResult,
  type HumanApproval,
} from './result';

const inputSchema = z.object({ url: z.string().min(1).max(2048) }).strict();
const limitations = [
  'Mocked model responses only; no language model or inference provider is active.',
  'Only three supported claim kinds are independently checked. Novel claims and changed narratives are refused.',
  'Backend validation certifies exact pinned added-line evidence and the supported predicate, not comprehensive security, runtime exposure or current PR state after capture.',
  'Missing context, unobserved windows and uninventoried files have no safety assessment.',
  'Model and repository content cannot authorize publication. Human approval permits only manual copy; there is no GitHub write capability.',
];
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
export interface AgentDependencies {
  model: ProposalModelAdapter;
  /** Explicit backend configuration only. Default remains mock-only. */
  allowRealModel?: boolean;
  /** Trusted backend dependency; never accepted from a model/browser argument. */
  transport?: Transport;
  signal?: AbortSignal;
  /** Reductions only, primarily for bounded synthetic tests. */
  limits?: Partial<AgentLimits>;
}
export async function runAgentReview(
  input: unknown,
  dependencies: AgentDependencies,
): Promise<{ result: AgentResult; humanApproval: HumanApproval }> {
  const controller = new AbortController(),
    signal = dependencies.signal
      ? AbortSignal.any([controller.signal, dependencies.signal])
      : controller.signal;
  const budget = new AgentBudget(signal, {
    ...dependencies.limits,
    modelCalls: 1,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budget.limits.durationMs);
  let evidence: BackendEvidence | undefined, client: GitHubClient | undefined;
  const result: AgentResult = {
    protocolVersion: 1,
    workflow: 'single-inference',
    runId: randomUUID(),
    status: 'failed',
    ai: { mode: 'mock-only', realInference: false },
    capture: null,
    coverage: null,
    findings: [],
    rejected: [],
    trace: [],
    budget: {
      steps: 0,
      tools: 0,
      modelCalls: 0,
      validationChecks: 0,
      observationBytes: 0,
      githubRequests: 0,
      upstreamBytes: 0,
      sourceFiles: null,
      elapsedMs: 0,
    },
    publication: {
      status: 'requires-human-approval',
      automaticPublication: false,
    },
    limitations: [...limitations],
    rateLimit: {},
  };
  const stage = (
    name: AgentResult['trace'][number]['stage'],
    tool?: string,
    code?: string,
  ) =>
    result.trace.push({
      stage: name,
      step: budget.steps,
      ...(tool ? { tool } : {}),
      ...(code ? { code } : {}),
    });
  try {
    stage('investigate');
    budget.check();
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success || byteLength(JSON.stringify(parsed.data)) > 2048)
      throw new ReviewError(
        'INVALID_AGENT_INPUT',
        'Provide only a canonical public PR URL.',
      );
    parsePullRequestUrl(parsed.data.url);
    if (
      dependencies.model.mode !== 'mock' &&
      !(dependencies.allowRealModel && dependencies.model.mode === 'workers-ai')
    ) {
      result.status = 'disabled';
      result.ai.mode = 'disabled';
      result.rejected.push({ code: 'REAL_MODEL_DISABLED' });
    } else {
      client = new GitHubClient(dependencies.transport, signal);
      evidence = await BackendEvidence.capture(
        parsed.data.url,
        client,
        result.runId,
        budget,
      );
      result.budget.sourceFiles = evidence.sourceFiles;
      result.capture = evidence.identity();
      if (!evidence.verified) throw new AgentFailure('SNAPSHOT_UNVERIFIED');
      budget.step();
      stage('prepare-evidence');
      const prepared = evidence.prepareProposalRequest();
      result.contextCoverage = {
        ...prepared.evidence.coverage,
        files: prepared.evidence.files.map((f) => ({
          path: f.path,
          lines: f.lines.map((l) => l.line),
          addedLines: f.lines.filter((l) => l.added).map((l) => l.line),
        })),
        dispatch: 'not-sent',
      };
      if (!prepared.evidence.coverage.providedAddedLines) {
        result.status = 'refused';
        result.rejected.push({ code: 'INSUFFICIENT_EVIDENCE' });
      } else {
        const serialized = JSON.stringify(prepared);
        if (byteLength(serialized) > budget.limits.modelInputBytes)
          throw new AgentFailure('MODEL_INPUT_LIMIT');
        budget.step();
        budget.model();
        stage('propose-once');
        evidence.exposePrepared(prepared);
        result.contextCoverage.dispatch = 'attempted';
        let text: string;
        try {
          text = await budget.wait(
            dependencies.model.propose(
              freeze(structuredClone(prepared)),
              signal,
            ),
          );
        } catch (error) {
          if (error instanceof AgentFailure) throw error;
          throw new AgentFailure('MODEL_ERROR');
        }
        budget.check();
        if (
          typeof text !== 'string' ||
          byteLength(text) > budget.limits.modelOutputBytes
        )
          throw new AgentFailure('MODEL_OUTPUT_LIMIT');
        const proposals = parseProposals('submit_review', text);
        if (!proposals.success) throw new AgentFailure(proposals.code);
        budget.check();
        result.contextCoverage.dispatch = 'response-received';
        stage('validate');
        const seen = new Set<string>();
        for (const [index, hypothesis] of proposals.data.proposals.entries()) {
          budget.check();
          const key = JSON.stringify(hypothesis);
          if (seen.has(key)) {
            result.rejected.push({ index, code: 'DUPLICATE_FINDING' });
            continue;
          }
          seen.add(key);
          const supplied = prepared.evidence.files
            .find((f) => f.path === hypothesis.path)
            ?.lines.find((l) => l.line === hypothesis.line && l.added);
          if (!supplied) {
            result.rejected.push({
              index,
              code: 'EVIDENCE_NOT_SUPPLIED_ADDED_LINE',
            });
            continue;
          }
          const issued = evidence.execute({
            name: 'createReviewFinding',
            arguments: hypothesis,
          }) as {
            accepted: boolean;
            code: string;
            factCard?: { evidenceId: string };
          };
          if (!issued.accepted || !issued.factCard) {
            result.rejected.push({ index, code: issued.code });
            continue;
          }
          const validation = evidence.execute({
            name: 'validateReviewFinding',
            arguments: { evidenceId: issued.factCard.evidenceId },
          }) as { accepted: boolean; code: string };
          budget.check();
          if (!validation.accepted) {
            result.rejected.push({ index, code: validation.code });
            continue;
          }
          // The model selected this hypothesis; the backend resolves its independently validated issued card.
          const finding = evidence.factCard(issued.factCard.evidenceId);
          if (!finding) throw new AgentFailure('SNAPSHOT_UNVERIFIED');
          if (result.findings.length >= budget.limits.findings)
            throw new AgentFailure('VALIDATION_LIMIT');
          result.findings.push({
            ...finding,
            id: finding.evidenceId,
            source:
              dependencies.model.mode === 'workers-ai'
                ? 'workers-ai'
                : 'mock-model',
            evidenceValidation: 'backend-pinned-supported-predicate',
          });
        }
        result.status = 'partial';
        result.limitations.push(
          'One model response selected hypotheses only from supplied source windows. Omitted source and unproposed claims remain unreviewed; no comprehensive inspection is attested.',
        );
      }
    }
  } catch (error) {
    const code =
      timedOut || (error instanceof AgentFailure && error.code === 'TIME_LIMIT')
        ? 'REVIEW_DEADLINE'
        : error instanceof AgentFailure || error instanceof ReviewError
          ? error.code
          : 'CAPTURE_FAILED';
    result.rejected.push({
      code,
      ...(error instanceof AgentFailure && error.diagnostic
        ? { diagnostic: error.diagnostic }
        : {}),
    });
    result.status =
      code === 'CANCELLED'
        ? 'cancelled'
        : [
              'STEP_LIMIT',
              'TOOL_LIMIT',
              'TOOL_NO_PROGRESS',
              'MODEL_CALL_LIMIT',
              'VALIDATION_LIMIT',
              'TIME_LIMIT',
              'REVIEW_DEADLINE',
              'REVIEW_GRANT_EXPIRED',
              'SNAPSHOT_UNVERIFIED',
            ].includes(code)
          ? 'partial'
          : 'failed';
    result.findings = []; // No approval/export of results after cancellation or terminal limits/errors.
  } finally {
    clearTimeout(timer);
    controller.abort();
    result.coverage = evidence?.summary() ?? null;
    result.rateLimit = { ...client?.rateLimit };
    result.budget = {
      steps: Math.min(budget.steps, budget.limits.steps),
      tools: Math.min(budget.toolCalls, budget.limits.toolCalls),
      modelCalls: Math.min(budget.modelCalls, budget.limits.modelCalls),
      validationChecks: Math.min(
        budget.validationChecks,
        budget.limits.validationChecks,
      ),
      observationBytes: budget.observationBytes,
      githubRequests: client?.requests ?? 0,
      upstreamBytes: client?.bytes ?? 0,
      sourceFiles: result.budget.sourceFiles,
      elapsedMs: Math.round(performance.now() - budget.started),
    };
    stage('finalize');
    if (
      dependencies.allowRealModel &&
      dependencies.model.mode === 'workers-ai'
    ) {
      const invocation = dependencies.model.diagnostics?.();
      result.ai = {
        mode: 'workers-ai',
        realInference: !!invocation?.responses,
        attempts: invocation?.attempts ?? 0,
        responses: invocation?.responses ?? 0,
      };
      result.limitations[0] = result.ai.realInference
        ? 'Native Workers AI decisions; independently checked only against the three supported predicates. No automatic publication.'
        : 'No confirmed model response. A timed-out invocation may still consume shared quota. No automatic retry.';
    }
  }
  if (byteLength(JSON.stringify(result)) > budget.limits.resultBytes) {
    result.status = 'failed';
    result.findings = [];
    result.coverage = null;
    result.capture = null;
    result.contextCoverage = undefined;
    result.rejected = [{ code: 'RESULT_LIMIT' }];
    result.trace = [];
    result.rateLimit = { ...result.rateLimit, resource: undefined };
    result.limitations = [
      'Result limit; findings suppressed; coverage unknown.',
    ];
  }
  if (byteLength(JSON.stringify(result)) > budget.limits.resultBytes)
    throw new AgentFailure('RESULT_LIMIT');
  return {
    result: structuredClone(result),
    humanApproval: humanApprovalGate(
      result,
      undefined,
      budget.limits.reportBytes,
    ),
  };
}
export { AGENT_LIMITS };
