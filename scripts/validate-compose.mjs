import { spawnSync } from 'node:child_process';
process.env.TEST_API_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080';
process.env.TEST_DELIVERY_ORIGIN = process.env.TEST_API_ORIGIN;
const result = spawnSync(
  process.execPath,
  ['--env-file=.env', process.argv[2] ?? 'scripts/integration.mjs'],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
