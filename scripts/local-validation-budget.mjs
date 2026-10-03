import Redis from 'ioredis';
import { spawnSync } from 'node:child_process';
const url = new URL(process.env.REDIS_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local diagnostic only');
const redis = new Redis(process.env.REDIS_URL);
try {
  let cursor = '0',
    windows = [];
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:auth:*', 'COUNT', 100);
    cursor = next;
    for (const key of keys)
      windows.push({ used: Number(await redis.get(key)), secondsRemaining: await redis.ttl(key) });
  } while (cursor !== '0');
  console.log('Active local authentication quota windows', JSON.stringify(windows));
} finally {
  await redis.quit();
}
const logs = spawnSync(
  'docker',
  [
    'compose',
    'logs',
    '--no-color',
    '--tail',
    '1000',
    'api',
    'delivery',
    'worker',
    'scheduler',
    'postgres',
    'reverse-proxy',
    'object-storage',
  ],
  { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
);
if (logs.status !== 0) throw new Error('Could not inspect local logs');
const data = logs.stdout + logs.stderr;
console.log(
  'Known private synthetic claim values found in recent logs:',
  /secret-private-bio|Hidden persona employer|Exact Street 42|Private browser biography|authenticated-context-value|connection-context-value|organization-context-value/.test(
    data,
  ),
);
