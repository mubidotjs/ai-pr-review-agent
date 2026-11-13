import { writeFileSync } from 'node:fs';
import { ingestionPayloadEnvelope } from '../tests/ingestion-payload-fixture';
const result = await ingestionPayloadEnvelope();
writeFileSync(
  'docs/milestone-3-payload-envelope.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
