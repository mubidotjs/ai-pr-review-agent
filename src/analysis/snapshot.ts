import { z } from 'zod';
import { LIMITS, type ReviewInputSnapshot } from '../shared/types';
import {
  byteLength,
  repoPath,
  safePath,
  validOwner,
  validRepo,
} from '../shared/source';
import { identity } from '../shared/eligibility';
import { ReviewError } from '../shared/errors';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f\d]{40}$/i);
const repository = z
  .object({ fullName: z.string().max(141), private: z.literal(false) })
  .strict();
const snapshotIdentity = z
  .object({
    baseSha: sha,
    headSha: sha,
    changedFiles: count,
    headRepo: z.string().max(141).nullable(),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(64),
    pr: z
      .object({
        owner: z.string().max(39),
        repo: z.string().max(100),
        number: count.min(1),
        url: z.string().max(2048),
        title: z.string().max(16384),
        description: z.string().max(262144),
        state: z.enum(['open', 'closed', 'merged']),
        author: z.string().max(100),
        baseSha: sha,
        headSha: sha,
        headRepo: repository.nullable(),
        changedFiles: count,
        additions: count,
        deletions: count,
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: z.string().max(2048),
            previousPath: z.string().max(2048).optional(),
            status: z.string().max(40),
            additions: count,
            deletions: count,
            patch: z.string().max(LIMITS.patchBytes).optional(),
            patchOmitted: z.literal('oversized').optional(),
            contextReason: z.string().max(1024).optional(),
            context: z
              .object({
                repository: z.string().max(141),
                sha,
                path: z.string().max(2048),
                text: z.string().max(LIMITS.sourceBytes),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(LIMITS.files),
    verification: z
      .object({ before: snapshotIdentity, after: snapshotIdentity.nullable() })
      .strict(),
    notices: z.array(z.string().max(2048)).max(110),
    budget: z
      .object({
        requests: count.max(LIMITS.requests),
        bytes: count.max(LIMITS.totalBytes + LIMITS.responseBytes),
        contextFiles: count.max(LIMITS.contextFiles),
        diffLines: count.max(LIMITS.diffLines),
        durationMs: count,
      })
      .strict(),
    rateLimit: z
      .object({
        limit: count.optional(),
        remaining: count.optional(),
        used: count.optional(),
        resetAt: count.optional(),
        retryAt: count.optional(),
        resource: z.string().max(100).optional(),
      })
      .strict(),
    synthetic: z.boolean().optional(),
  })
  .strict();
export function validateSnapshot(input: unknown): ReviewInputSnapshot {
  const parsed = schema.safeParse(input);
  const invalid = () =>
    new ReviewError(
      'INVALID_SNAPSHOT',
      'Review input is malformed, oversized, or inconsistent.',
    );
  if (!parsed.success) throw invalid();
  const value = parsed.data;
  if (byteLength(JSON.stringify(value)) > LIMITS.snapshotBytes) throw invalid();
  const { pr } = value;
  if (
    !validOwner(pr.owner) ||
    !validRepo(pr.repo) ||
    pr.url !== `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}` ||
    value.files.length > pr.changedFiles ||
    new Set(value.files.map((f) => f.path)).size !== value.files.length
  )
    throw invalid();
  if (pr.headRepo) repoPath(pr.headRepo);
  const same = (
    a: ReturnType<typeof identity>,
    b: ReturnType<typeof identity>,
  ) =>
    a.baseSha === b.baseSha &&
    a.headSha === b.headSha &&
    a.changedFiles === b.changedFiles &&
    a.headRepo === b.headRepo;
  if (
    !same(value.verification.before, identity(pr)) ||
    (value.verification.after &&
      !same(value.verification.before, value.verification.after))
  )
    throw invalid();
  let contexts = 0;
  for (const file of value.files) {
    if (
      file.patch &&
      (file.patchOmitted || byteLength(file.patch) > LIMITS.patchBytes)
    )
      throw invalid();
    if (!file.context) continue;
    contexts++;
    if (
      !pr.headRepo ||
      !safePath(file.path) ||
      file.context.path !== file.path ||
      file.context.repository !== pr.headRepo.fullName ||
      file.context.sha !== pr.headSha ||
      byteLength(file.context.text) > LIMITS.sourceBytes ||
      file.contextReason
    )
      throw invalid();
  }
  if (
    contexts > LIMITS.contextFiles ||
    contexts > value.budget.contextFiles ||
    (!value.verification.after && contexts !== 0)
  )
    throw invalid();
  return value;
}
