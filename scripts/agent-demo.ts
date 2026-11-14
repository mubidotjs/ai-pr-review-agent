import { createInterface } from 'node:readline/promises';
import { runAgentReview } from '../src/server/agent/engine';
import { mockProposals, supportedProposals } from '../tests/proposal-fixtures';
import { fixtureTransport, PR_URL } from '../tests/upstream-fixtures';

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== '--approve') || flags.length > 1)
  throw new Error(
    'Usage: npm run agent:demo -- [--approve]. Synthetic input only.',
  );
const abort = new AbortController();
const cancel = () => abort.abort();
process.once('SIGINT', cancel);
const run = await runAgentReview(
  { url: PR_URL },
  {
    model: mockProposals(supportedProposals),
    transport: fixtureTransport(),
    signal: abort.signal,
  },
);
process.off('SIGINT', cancel);
console.log(
  'PRISM — LOCAL SINGLE-INFERENCE MOCK REVIEW. Zero real model/GitHub calls.',
);
console.log(
  JSON.stringify(
    {
      status: run.result.status,
      mockFindings: run.result.findings.length,
      coverage: run.result.coverage && {
        total: run.result.coverage.total,
        inventoried: run.result.coverage.inventoried,
        inspected: run.result.coverage.inspected,
        supportedPredicateChecks: run.result.coverage.semanticChecksCompleted,
        uninspected: run.result.coverage.uninspected,
        uninventoried: run.result.coverage.uninventoried,
      },
      budget: run.result.budget,
      trace: run.result.trace,
    },
    null,
    2,
  ),
);
console.log(run.humanApproval.preview());
if (flags.includes('--approve')) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Human approval requires an interactive terminal. No approval or publication performed.',
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const required = `APPROVE ${run.humanApproval.digest}`;
    const answer = await terminal.question(
      `Review the draft above. To approve these mock findings for manual copy only, type:\n${required}\n> `,
    );
    if (answer !== required) console.log('Not approved. Nothing published.');
    else {
      const approved = run.humanApproval.approve({
        actor: 'human',
        confirm: true,
        runId: run.humanApproval.runId,
        digest: run.humanApproval.digest,
        selectedIds: run.result.findings.map((f) => f.id),
      });
      console.log(approved.markdown);
    }
  } finally {
    terminal.close();
  }
}
