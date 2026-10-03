import { readFileSync, writeFileSync } from 'node:fs';
const license = readFileSync('LICENSE');
for (const p of [
  'packages/sdk-typescript/LICENSE',
  'packages/ui/LICENSE',
  'integrations/python/LICENSE',
  'integrations/php/LICENSE',
])
  writeFileSync(p, license);
console.log('Package license texts match the repository GPL-2.0 license.');
