import { releaseEntry } from '../src/server/release/entry';
import { releaseConfig } from '../src/server/release/environment';
import { createReleaseAgent } from '../src/server/release/agent-app';
export default releaseEntry(() => createReleaseAgent(releaseConfig()));
