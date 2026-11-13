import type { Review } from './types';

// Escape syntax and control characters before placing untrusted text in Markdown.
export function markdownText(value: string): string {
  // eslint-disable-next-line no-control-regex -- strip unsafe control characters from exported Markdown
  const controls = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
  return value
    .replace(controls, '')
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    .replace(/([\\`*_{}[\]()#+.!|~>-])/g, '\\$1');
}
export function reviewReport(review: Review): string {
  const { pr, coverage: c } = review;
  const out = [
    '# PRISM — deterministic PR review',
    ...(review.synthetic
      ? ['**Synthetic demonstration; not a real pull request.**']
      : []),
    `## ${markdownText(pr.title)}`,
    `Repository: ${markdownText(`${pr.owner}/${pr.repo}`)} · PR #${pr.number}`,
    `PR: ${pr.url}`,
    `Head: ${pr.headSha} · Base: ${pr.baseSha}`,
    `Snapshot verified: ${review.snapshotVerified ? 'yes' : 'no'}. AI disabled; no inference performed.`,
    'Deterministic findings are computed in a browser Web Worker. They have no server attestation and must be independently revalidated before external use.',
    `Coverage: ${c.total} total; ${c.inventoried} inventoried; ${c.analyzed} analyzed; ${c.skipped} skipped; ${c.uninventoried} uninventoried.`,
    '**This is a limited rule review, not a security clearance. Zero findings does not mean the code is safe.**',
    '## Findings',
    ...(review.findings.length
      ? review.findings.flatMap((f) => [
          `### ${f.severity.toUpperCase()} — ${markdownText(f.title)}`,
          `Source: ${f.source} · ${markdownText(f.path)}:${f.line}`,
          markdownText(f.explanation),
          `Recommendation: ${markdownText(f.recommendation)}`,
          `Evidence: ${markdownText(f.evidence)}`,
          `Source link: ${f.sourceUrl}`,
        ])
      : ['No findings from the available rules.']),
    '## File inventory',
    ...review.files.map(
      (f) =>
        `- ${markdownText(f.path)} — ${f.reviewStatus}${f.reason ? `: ${markdownText(f.reason)}` : ''}`,
    ),
    '## Limitations and notices',
    ...review.notices.map((n) => `- ${markdownText(n)}`),
    '- Unreviewed and uninventoried files have no safety assessment.',
    '- Human review is required before acting on any suggestion.',
  ];
  return out.join('\n\n') + '\n';
}
