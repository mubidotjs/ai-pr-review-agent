import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { GitHubClient, type Transport } from '../github';
import { byteLength, parsePullRequestUrl, ReviewError } from '../security';
import { AgentBudget, AgentFailure } from './budget';
import { BackendEvidence } from './evidence';
import {
  AGENT_LIMITS,
  SYSTEM_POLICY,
  TOOL_CONTRACTS,
  decisionSchema,
  type AgentLimits,
  type AgentModelAdapter,
  type ModelRequest,
  type Observation,
} from './protocol';
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
  model: AgentModelAdapter;
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
  const budget = new AgentBudget(signal, dependencies.limits);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budget.limits.durationMs);
  let evidence: BackendEvidence | undefined, client: GitHubClient | undefined;
  const result: AgentResult = {
    protocolVersion: 1,
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
      const observations: Observation[] = [];
      for (;;) {
        budget.step();
        stage('select-read-only-tool');
        budget.model();
        const request: ModelRequest = {
          protocolVersion: 1,
          system: SYSTEM_POLICY,
          tools: TOOL_CONTRACTS,
          factCards: evidence.factCards(),
          untrusted: {
            label: 'UNTRUSTED_REPOSITORY_DATA',
            observations: observations.slice(-3),
          },
          remaining: {
            steps: budget.limits.steps - budget.steps,
            toolCalls: budget.limits.toolCalls - budget.toolCalls,
            modelCalls: budget.limits.modelCalls - budget.modelCalls,
          },
        };
        if (byteLength(JSON.stringify(request)) > budget.limits.modelInputBytes)
          throw new AgentFailure('MODEL_INPUT_LIMIT');
        let text: string;
        try {
          text = await budget.wait(
            dependencies.model.next(freeze(structuredClone(request)), signal),
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
        let response: unknown;
        try {
          response = JSON.parse(text);
        } catch {
          throw new AgentFailure('INVALID_MODEL_RESPONSE');
        }
        const decision = decisionSchema.safeParse(response);
        if (!decision.success) throw new AgentFailure('INVALID_MODEL_RESPONSE');
        if (decision.data.type === 'refuse') {
          result.status = 'refused';
          result.rejected.push({ code: decision.data.reason });
          break;
        }
        if (decision.data.type === 'tool') {
          const call = decision.data.call;
          const data = evidence.execute(call);
          observations.push({ tool: call.name, data });
          const refused = data as {
            ok?: boolean;
            accepted?: boolean;
            code?: string;
          };
          const code =
            refused.ok === false || refused.accepted === false
              ? refused.code
              : undefined;
          if (code) result.rejected.push({ code });
          stage('observe', call.name, code);
          continue;
        }
        stage('generate-findings');
        stage('validate');
        const proposed = decision.data.findings;
        if (proposed.length > budget.limits.findings)
          throw new AgentFailure('VALIDATION_LIMIT');
        const seen = new Set<string>();
        for (const [index, candidate] of proposed.entries()) {
          const verdict = evidence.validateReviewFinding(candidate);
          budget.check();
          if (!verdict.accepted || !verdict.finding) {
            result.rejected.push({ index, code: verdict.code });
            continue;
          }
          if (seen.has(verdict.finding.evidenceId)) {
            result.rejected.push({ index, code: 'DUPLICATE_FINDING' });
            continue;
          }
          seen.add(verdict.finding.evidenceId);
          result.findings.push({
            ...verdict.finding,
            id: verdict.finding.evidenceId,
            source:
              dependencies.model.mode === 'workers-ai'
                ? 'workers-ai'
                : 'mock-model',
            evidenceValidation: 'backend-pinned-supported-predicate',
          });
        }
        const coverage = evidence.summary();
        result.status =
          result.rejected.length ||
          coverage.inspected < coverage.total ||
          coverage.semanticChecksCompleted < coverage.total
            ? 'partial'
            : 'draft';
        break;
      }
    }
  } catch (error) {
    const code = timedOut
      ? 'TIME_LIMIT'
      : error instanceof AgentFailure || error instanceof ReviewError
        ? error.code
        : 'CAPTURE_FAILED';
    result.rejected.push({ code });
    result.status =
      code === 'CANCELLED'
        ? 'cancelled'
        : [
              'STEP_LIMIT',
              'TOOL_LIMIT',
              'MODEL_CALL_LIMIT',
              'VALIDATION_LIMIT',
              'TIME_LIMIT',
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
