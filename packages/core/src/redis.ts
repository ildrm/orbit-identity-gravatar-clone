import { Redis } from 'ioredis';
import { config } from './config.js';
let client: Redis | undefined;
export function redis(): Redis {
  return (client ??= new Redis(config().REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  }));
}
export async function connectRedis(): Promise<void> {
  const r = redis();
  if (r.status === 'wait') await r.connect();
  await r.ping();
}
export async function rateLimit(
  key: string,
  limit: number,
  seconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const result = (await redis().eval(
    "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n",
    1,
    'rate:' + key,
    seconds,
  )) as number;
  return { allowed: result <= limit, remaining: Math.max(0, limit - result) };
}
export async function closeRedis() {
  if (client && client.status !== 'end') await client.quit();
}
