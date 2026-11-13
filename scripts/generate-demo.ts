import { mkdirSync, writeFileSync } from 'node:fs';
import { createDemoInput } from '../tests/fixtures';
mkdirSync('src/client', { recursive: true });
writeFileSync(
  'src/client/demo-input.json',
  JSON.stringify(createDemoInput(), null, 2) + '\n',
);
console.log('Generated synthetic demo from the real deterministic pipeline.');
