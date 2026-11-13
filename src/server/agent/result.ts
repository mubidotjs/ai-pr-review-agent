import { createHash } from 'node:crypto';
import { z } from 'zod';
import { markdownText } from '../../shared/report';
import { byteLength } from '../../shared/source';
import type { BackendEvidence } from './evidence';
import type { RateLimit } from '../../shared/types';
import type { Candidate, AgentStage } from './protocol';

export interface AgentResult {
  protocolVersion: 1;
  runId: string;
  status: 'draft' | 'partial' | 'refused' | 'failed' | 'cancelled' | 'disabled';
  ai: {
    mode: 'mock-only' | 'disabled' | 'workers-ai';
    realInference: boolean;
    attempts?: number;
    responses?: number;
  };
  capture: ReturnType<BackendEvidence['identity']> | null;
  coverage: ReturnType<BackendEvidence['summary']> | null;
  findings: (Candidate & {
    id: string;
    source: 'mock-model' | 'workers-ai';
    evidenceValidation: 'backend-pinned-supported-predicate';
  })[];
  rejected: { index?: number; code: string }[];
  trace: { stage: AgentStage; step: number; tool?: string; code?: string }[];
  budget: {
    steps: number;
    tools: number;
    modelCalls: number;
    validationChecks: number;
    observationBytes: number;
    githubRequests: number;
    upstreamBytes: number;
    sourceFiles: number | null;
    elapsedMs: number;
  };
  publication: {
    status: 'requires-human-approval';
    automaticPublication: false;
  };
  limitations: string[];
  rateLimit: RateLimit;
}
export interface HumanApproval {
  readonly runId: string;
  readonly digest: string;
  preview(): string;
  approve(input: unknown): {
    status: 'approved-for-manual-copy';
    markdown: string;
    selectedIds: string[];
    publicationPerformed: false;
  };
}
export function agentReport(
  result: AgentResult,
  approved = false,
  selected = result.findings,
): string {
  const coverage = result.coverage;
  return (
    [
      result.ai.realInference
        ? '# PRISM — AI review draft'
        : '# PRISM — MOCK model review draft',
      result.ai.realInference
        ? '**Native Workers AI proposals with backend evidence validation. Not a security clearance.**'
        : '**No confirmed real inference. Mock results are synthetic. Not a security clearance.**',
      approved
        ? '**Human-approved selection for manual copy only. Nothing has been published.**'
        : '**UNAPPROVED: human review required before any publication.**',
      `Run: ${result.runId} · Status: ${result.status}`,
      result.capture
        ? `Capture: ${result.capture.captureId} · Head: ${result.capture.headSha}\n\nPR: ${result.capture.url}`
        : 'No trusted capture; coverage unknown.',
      coverage
        ? `Coverage: ${coverage.total} total; ${coverage.inventoried} inventoried; ${coverage.inspected} files with observed windows; ${coverage.semanticChecksCompleted} files checked for supported predicates; ${coverage.uninspected} uninspected; ${coverage.uninventoried} uninventoried. Observing a window is not reviewing an entire file.`
        : 'No coverage assertion available.',
      ...selected.flatMap((f) => [
        `## ${f.severity.toUpperCase()} — ${markdownText(f.title)}`,
        `Source: ${f.source === 'workers-ai' ? 'Workers AI' : 'MOCK model'} proposal; backend-validated pinned evidence · ${markdownText(f.path)}:${f.line}`,
        markdownText(f.explanation),
        `Recommendation: ${markdownText(f.recommendation)}`,
        `Evidence: ${markdownText(f.evidence)}`,
        `Source: ${f.sourceUrl}`,
      ]),
      ...(!selected.length
        ? ['No supported model proposals. This does not establish safety.']
        : []),
      '## Explicit refusals',
      ...result.rejected.map(
        (r) =>
          `- ${r.code}${r.index === undefined ? '' : ` (candidate ${r.index + 1})`}`,
      ),
      '## Limitations',
      ...result.limitations.map((text) => `- ${markdownText(text)}`),
      ...(coverage
        ? [
            '## Investigation coverage',
            ...coverage.files.map(
              (file) =>
                `- ${markdownText(file.path)}: ${file.validation}; ${markdownText(file.reason ?? 'No comprehensive assessment.')}`,
            ),
          ]
        : []),
    ].join('\n\n') + '\n'
  );
}
/** An in-memory local human interface, deliberately absent from model tools. */
export function humanApprovalGate(
  result: AgentResult,
  now = () => performance.now(),
  reportBytes = 1024 * 1024,
): HumanApproval {
  const sealed = structuredClone(result),
    expiresAt = now() + 5 * 60 * 1000;
  const digest = createHash('sha256')
    .update(JSON.stringify(sealed))
    .digest('hex');
  let used = false;
  const render = (approved = false, selected = sealed.findings) => {
    const report = agentReport(sealed, approved, selected);
    if (byteLength(report) > reportBytes)
      throw new Error('Report byte budget exceeded.');
    return report;
  };
  return Object.freeze({
    runId: sealed.runId,
    digest,
    preview: () => render(),
    approve(input: unknown) {
      const decision = z
        .object({
          actor: z.literal('human'),
          confirm: z.literal(true),
          runId: z.literal(sealed.runId),
          digest: z.literal(digest),
          selectedIds: z.array(z.string().max(100)).min(1).max(100),
        })
        .strict()
        .safeParse(input);
      if (
        !decision.success ||
        used ||
        now() >= expiresAt ||
        !['draft', 'partial'].includes(sealed.status)
      )
        throw new Error('Human approval refused.');
      const ids = decision.data.selectedIds;
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !sealed.findings.some((f) => f.id === id))
      )
        throw new Error('Human approval refused.');
      used = true;
      const selected = sealed.findings.filter((f) => ids.includes(f.id));
      return {
        status: 'approved-for-manual-copy' as const,
        markdown: render(true, selected),
        selectedIds: [...ids],
        publicationPerformed: false as const,
      };
    },
  });
}
