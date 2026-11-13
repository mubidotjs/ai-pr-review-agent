import { LIMITS } from '../../src/shared/types';

// Offline proof for a valid snapshot produced by ingestPullRequest, not an
// arbitrary snapshot supplied directly to serializeSnapshot. No live requests.
export function ingestionEnvelopeBound() {
  // JSON.stringify does not expand a valid JSON string beyond its original
  // JSON token's bytes. Number normalization and generated fields are separate.
  const filePages = 2 * LIMITS.responseBytes;
  const initialMetadata = LIMITS.responseBytes;
  const rawSources = LIMITS.contextFiles * LIMITS.sourceBytes;
  // Worst-case six-byte JSON escapes per UTF-16 unit; deliberately count even
  // impossible combinations (e.g. control characters in safe source paths).
  const expansion = {
    contextReasons: LIMITS.files * 1024 * 6,
    // Only the page-fetch catch and final-verification catch append notices.
    notices: 2 * 2048 * 6,
    contextDescriptors: LIMITS.contextFiles * (2048 + 141 + 40) * 6,
    derivedPrReference: (2048 + 39 + 100) * 6,
    verificationIdentities: 2 * (80 + 141) * 6,
    rateResource: 100 * 6,
    // Structural keys, counts (including scientific-to-decimal conversion),
    // UUID, frame header and remaining fixed scalar fields. Files' original
    // paths/patches/statuses are already charged in filePages, not re-added.
    scalarAndStructuralAllowance: 16 * 1024,
  };
  const extra = Object.values(expansion).reduce((a, b) => a + b, 0);
  const allowance = 1024 * 1024;
  if (extra > allowance) throw new Error('Reassess generated-field allowance.');
  return {
    filePages,
    initialMetadata,
    rawSources,
    expansion,
    generatedFieldBound: extra,
    generatedFieldAllowance: allowance,
    conservativeFrameBound:
      filePages + initialMetadata + rawSources + allowance,
    configuredFrameCeiling: LIMITS.snapshotBytes,
    ceilingReachableByValidIngestion: false,
    qualifications: [
      'Counts a single retained PR metadata response; final metadata only verifies identity.',
      'Upstream 8-MiB aggregate, request/time and diff limits can only tighten this bound.',
      'Valid browser snapshots constrain rateLimit.resource to 100 characters. Oversized headers/malformed upstream data are not valid reviews.',
      'The 12-MiB fixture bypasses acquisition and remains a required transport stress test.',
    ],
  };
}
