import { createHash } from 'node:crypto';
import { analyzeFile } from '../../analysis/rules';
import { scanPatch } from '../../shared/patch';
import { ineligibleReason } from '../../shared/eligibility';
import { byteLength, safePath } from '../../shared/source';
import {
  LIMITS,
  type ReviewFile,
  type ReviewInputSnapshot,
  type ReviewInputFile,
} from '../../shared/types';
import { AgentBudget, AgentFailure } from './budget';
import { ingestPullRequest, serializeSnapshot } from '../review';
import type { GitHubClient } from '../github';
import {
  candidateSchema,
  type Candidate,
  type Hypothesis,
  type ToolCall,
} from './protocol';

type RecordFile = {
  raw: ReviewInputFile;
  file: ReviewFile;
  observed: Set<number>;
  checked: boolean;
  proof?: ReturnType<typeof analyzeFile>;
};
export interface EvidenceVerdict {
  accepted: boolean;
  code: string;
  finding?: Candidate;
}
const reject = (code: string): EvidenceVerdict => ({ accepted: false, code });
const reference = ({ evidenceId, kind, path, line }: Candidate) => ({
  evidenceId,
  kind,
  path,
  line,
});
function preview(text: string, bytes: number) {
  const encoded = new TextEncoder().encode(text);
  return {
    text:
      encoded.length <= bytes
        ? text
        : new TextDecoder().decode(encoded.subarray(0, bytes - 3)),
    truncated: encoded.length > bytes,
    originalBytes: encoded.length,
  };
}

/** Node-only authority. Created exclusively from backend ingestion, never browser JSON. */
export class BackendEvidence {
  private readonly snapshot: ReviewInputSnapshot;
  private readonly files = new Map<string, RecordFile>();
  private readonly cards = new Map<string, Candidate>();
  private metadataObserved = false;
  private readonly listed = new Set<string>();
  private progressRevision = 0;
  get revision() {
    return this.progressRevision;
  }
  private constructor(
    snapshot: ReviewInputSnapshot,
    private readonly runId: string,
    private readonly budget: AgentBudget,
  ) {
    this.snapshot = structuredClone(snapshot);
    let used = 0;
    for (const raw of this.snapshot.files) {
      budget.check();
      const diff = scanPatch(
        raw.patch,
        raw.additions,
        raw.deletions,
        LIMITS.diffLines - used,
        true,
      );
      used += diff.lineCount;
      const reason = ineligibleReason(
        raw,
        snapshot.pr,
        raw.patchOmitted ? 'Oversized patch.' : diff.reason,
      );
      this.files.set(raw.path, {
        raw,
        observed: new Set(),
        checked: false,
        file: {
          path: raw.path,
          status: raw.status,
          additions: raw.additions,
          deletions: raw.deletions,
          rows: diff.rows,
          reviewStatus: 'skipped',
          reason,
        },
      });
    }
    budget.check();
  }
  static async capture(
    url: string,
    client: GitHubClient,
    runId: string,
    budget: AgentBudget,
  ) {
    const snapshot = await budget.wait(ingestPullRequest(url, client));
    budget.check();
    const boundedFrame = serializeSnapshot(snapshot);
    await boundedFrame.body.cancel();
    budget.check();
    return new BackendEvidence(snapshot, runId, budget);
  }
  get sourceFiles() {
    return this.snapshot.budget.contextFiles;
  }
  get verified() {
    return this.snapshot.verification.after !== null;
  }
  private source(path: string) {
    if (!safePath(path)) return;
    const record = this.files.get(path),
      pr = this.snapshot.pr;
    if (
      !record ||
      record.file.reason ||
      !this.snapshot.verification.after ||
      !pr.headRepo ||
      pr.headRepo.private
    )
      return;
    const context = record.raw.context;
    if (
      !context ||
      context.repository !== pr.headRepo.fullName ||
      context.sha !== pr.headSha ||
      context.path !== path ||
      byteLength(context.text) > LIMITS.sourceBytes
    )
      return;
    return { record, context };
  }
  private resolve(hypothesis: Hypothesis): EvidenceVerdict {
    this.budget.validate();
    const source = this.source(hypothesis.path);
    if (!source) return reject('PINNED_SOURCE_UNAVAILABLE');
    const { record, context } = source;
    if (!record.observed.has(hypothesis.line))
      return reject('EVIDENCE_NOT_OBSERVED');
    const row = record.file.rows.find(
      (row) => row.kind === 'add' && row.newLine === hypothesis.line,
    );
    if (
      !row ||
      row.text !== hypothesis.evidence ||
      context.text.split(/\r?\n/)[hypothesis.line - 1] !== hypothesis.evidence
    )
      return reject('NOT_AN_EXACT_ADDED_LINE');
    if (!record.proof) {
      record.checked = true;
      try {
        record.proof = analyzeFile(record.file, context.text, this.snapshot.pr);
      } catch {
        record.proof = {
          findings: [],
          reason: 'Bounded semantic validation failed.',
        };
      }
    }
    this.budget.check();
    if (record.proof.reason) return reject('SEMANTIC_CONTEXT_UNAVAILABLE');
    const proof = record.proof.findings.find(
      (f) =>
        f.ruleId === hypothesis.kind &&
        f.line === hypothesis.line &&
        f.evidence === hypothesis.evidence,
    );
    if (!proof) return reject('CLAIM_NOT_SUPPORTED');
    const canonical = {
      kind: hypothesis.kind,
      path: proof.path,
      line: proof.line,
      evidence: proof.evidence,
      severity: proof.severity,
      title: proof.title,
      explanation: proof.explanation,
      recommendation: proof.recommendation,
      sourceUrl: proof.sourceUrl,
    };
    const evidenceId = createHash('sha256')
      .update(
        JSON.stringify({
          runId: this.runId,
          capture: this.snapshot.id,
          head: this.snapshot.pr.headSha,
          repository: this.snapshot.pr.headRepo!.fullName,
          ...canonical,
        }),
      )
      .digest('hex');
    return {
      accepted: true,
      code: 'SUPPORTED',
      finding: { ...canonical, evidenceId },
    };
  }
  /** Final validation does not trust a model's verdict, fields, URLs or evidence ID. */
  validateReviewFinding(value: unknown): EvidenceVerdict {
    const parsed = candidateSchema.safeParse(value);
    if (!parsed.success) return reject('INVALID_FINDING_SCHEMA');
    const candidate = parsed.data,
      issued = this.cards.get(candidate.evidenceId);
    if (!issued) return reject('UNISSUED_EVIDENCE');
    const verdict = this.resolve(candidate);
    if (!verdict.accepted || !verdict.finding) return verdict;
    if (
      !Object.entries(verdict.finding).every(
        ([key, value]) => candidate[key as keyof Candidate] === value,
      )
    )
      return reject('UNSUPPORTED_NARRATIVE_OR_COORDINATE');
    return {
      accepted: true,
      code: 'SUPPORTED',
      finding: structuredClone(verdict.finding),
    };
  }
  validateFactCard(evidenceId: string): EvidenceVerdict {
    const issued = this.cards.get(evidenceId);
    return issued
      ? this.validateReviewFinding(issued)
      : reject('UNISSUED_EVIDENCE');
  }
  allowedTools(): ToolCall['name'][] {
    const pendingSource = [...this.listed].some((path) => {
      const source = this.source(path);
      return (
        source &&
        !source.record.file.rows.some(
          (row) =>
            row.kind === 'add' && source.record.observed.has(row.newLine!),
        )
      );
    });
    return [
      ...(!this.metadataObserved ? ['getPullRequest' as const] : []),
      ...(!pendingSource && this.listed.size < this.files.size
        ? ['listChangedFiles' as const]
        : []),
      'readFileContext',
      'createReviewFinding',
      'validateReviewFinding',
    ];
  }
  execute(call: ToolCall): unknown {
    this.budget.tool();
    let data: unknown,
      commit = () => {};
    switch (call.name) {
      case 'getPullRequest': {
        const pr = this.snapshot.pr;
        data = {
          trust: 'untrusted-data',
          url: pr.url,
          title: preview(pr.title, 1024),
          description: preview(pr.description, 2048),
          state: pr.state,
          headSha: pr.headSha,
          baseSha: pr.baseSha,
          headRepository: pr.headRepo?.fullName ?? null,
          changedFiles: pr.changedFiles,
          snapshotVerified: !!this.snapshot.verification.after,
        };
        commit = () => {
          if (!this.metadataObserved) this.progressRevision++;
          this.metadataObserved = true;
        };
        break;
      }
      case 'listChangedFiles': {
        const { offset, count } = call.arguments;
        data = {
          total: this.snapshot.pr.changedFiles,
          inventoried: this.files.size,
          offset,
          files: [...this.files.values()]
            .slice(offset, offset + count)
            .map(({ raw, file }) => ({
              path: raw.path,
              previousPath: raw.previousPath,
              status: raw.status,
              additions: raw.additions,
              deletions: raw.deletions,
              firstAddedLine:
                file.rows.find((row) => row.kind === 'add')?.newLine ?? null,
              sourceAvailable: !!this.source(raw.path),
              unavailableReason:
                file.reason ??
                raw.contextReason ??
                (!raw.context ? 'Pinned context unavailable.' : undefined),
            })),
          nextOffset: offset + count < this.files.size ? offset + count : null,
        };
        commit = () => {
          for (const path of [...this.files.keys()].slice(
            offset,
            offset + count,
          )) {
            if (!this.listed.has(path)) this.progressRevision++;
            this.listed.add(path);
          }
        };
        break;
      }
      case 'readFileContext': {
        const { path, startLine, endLine } = call.arguments,
          source = this.source(path);
        if (!source) {
          data = { ok: false, code: 'PINNED_SOURCE_UNAVAILABLE' };
          break;
        }
        const lines = source.context.text.split(/\r?\n/);
        if (
          endLine < startLine ||
          endLine - startLine >= 80 ||
          endLine > lines.length
        ) {
          data = { ok: false, code: 'INVALID_SOURCE_WINDOW' };
          break;
        }
        const changed = new Set(
          source.record.file.rows
            .filter((row) => row.kind === 'add')
            .map((row) => row.newLine),
        );
        data = {
          trust: 'untrusted-data',
          repository: source.context.repository,
          headSha: source.context.sha,
          path,
          startLine,
          endLine,
          lines: lines.slice(startLine - 1, endLine).map((text, index) => ({
            line: startLine + index,
            text,
            added: changed.has(startLine + index),
          })),
        };
        commit = () => {
          for (let line = startLine; line <= endLine; line++) {
            if (!source.record.observed.has(line)) this.progressRevision++;
            source.record.observed.add(line);
          }
        };
        break;
      }
      case 'createReviewFinding': {
        const source = this.source(call.arguments.path);
        const evidence =
          source?.context.text.split(/\r?\n/)[call.arguments.line - 1];
        const verdict = this.resolve({
          ...call.arguments,
          evidence: evidence ?? '',
        });
        data = {
          accepted: verdict.accepted,
          code: verdict.code,
          ...(verdict.finding ? { factCard: reference(verdict.finding) } : {}),
        };
        if (verdict.finding)
          commit = () => {
            if (!this.cards.has(verdict.finding!.evidenceId))
              this.progressRevision++;
            this.cards.set(
              verdict.finding!.evidenceId,
              structuredClone(verdict.finding!),
            );
          };
        break;
      }
      case 'validateReviewFinding': {
        const verdict = this.validateFactCard(call.arguments.evidenceId);
        data = { accepted: verdict.accepted, code: verdict.code };
        break;
      }
    }
    this.budget.check();
    let bytes = byteLength(JSON.stringify(data));
    if (bytes > this.budget.limits.toolOutputBytes) {
      data = { ok: false, code: 'TOOL_OUTPUT_LIMIT' };
      commit = () => {};
      bytes = byteLength(JSON.stringify(data));
    }
    if (
      bytes > this.budget.limits.toolOutputBytes ||
      this.budget.observationBytes + bytes > this.budget.limits.observationBytes
    )
      throw new AgentFailure('OBSERVATION_LIMIT');
    this.budget.observationBytes += bytes;
    commit();
    return structuredClone(data);
  }
  summary() {
    const entries = [...this.files.values()],
      total = this.snapshot.pr.changedFiles;
    return {
      total,
      inventoried: entries.length,
      sourceAvailable: entries.filter((f) => this.source(f.raw.path)).length,
      inspected: entries.filter((f) => f.observed.size > 0).length,
      semanticChecksCompleted: entries.filter(
        (f) => f.checked && !f.proof?.reason,
      ).length,
      uninspected: entries.filter((f) => f.observed.size === 0).length,
      uninventoried: total - entries.length,
      files: entries.map((f) => ({
        path: f.raw.path,
        inspectedLines: [...f.observed].sort((a, b) => a - b),
        validation: f.checked
          ? f.proof?.reason
            ? 'incomplete'
            : 'supported-predicates-checked'
          : 'not-requested',
        reason:
          f.file.reason ??
          f.proof?.reason ??
          f.raw.contextReason ??
          (!f.raw.context
            ? 'Pinned source unavailable.'
            : f.observed.size === 0
              ? 'Not investigated by the model.'
              : 'Only the recorded windows were inspected.'),
      })),
    };
  }
  identity() {
    return {
      captureId: this.snapshot.id,
      url: this.snapshot.pr.url,
      headSha: this.snapshot.pr.headSha,
      baseSha: this.snapshot.pr.baseSha,
      repository: this.snapshot.pr.headRepo?.fullName ?? null,
    };
  }
  factCards() {
    return [...this.cards.values()].map(reference);
  }
}
