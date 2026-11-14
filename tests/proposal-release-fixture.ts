import { createReleaseAgent } from '../src/server/release/agent-app';
import { createReleaseIngestion } from '../src/server/release/ingestion';
import { fixtureTransport } from './upstream-fixtures';
import { post } from './release-fixtures';
import { supportedProposals } from './proposal-fixtures';
import { releaseFixture } from './release-fixtures';
import { proposalOutput, oneProposal } from './proposal-fixtures';
import type { ProposalResponse } from '../src/server/agent/proposal-protocol';
export function proposalReleaseFixture(
  response: ProposalResponse = oneProposal,
) {
  const f = releaseFixture();
  f.env.LEGACY_TEST_PROTOCOL = false;
  f.run.mockImplementation(async () => proposalOutput(response));
  return f;
}

export async function setupProposalRelease() {
  const f = proposalReleaseFixture(supportedProposals);
  const ingestion = createReleaseIngestion(f.config, fixtureTransport());
  const login = await ingestion(
    post('/api/session', { code: f.config.accessCode }),
  );
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const agent = createReleaseAgent(f.config, { transport: fixtureTransport() });
  return { ...f, cookie, agent };
}
