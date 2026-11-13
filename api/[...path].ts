import { releaseEntry } from '../src/server/release/entry';
import { releaseConfig } from '../src/server/release/environment';
import { createReleaseIngestion } from '../src/server/release/ingestion';
export default releaseEntry(() => createReleaseIngestion(releaseConfig()));
