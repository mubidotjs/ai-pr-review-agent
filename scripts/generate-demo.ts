import { mkdirSync, writeFileSync } from 'node:fs';
import { createDemo } from '../tests/fixtures';
mkdirSync('src/client', { recursive: true });
writeFileSync(
  'src/client/demo.json',
  JSON.stringify(createDemo(), null, 2) + '\n',
);
console.log('Generated synthetic demo from the real deterministic pipeline.');
