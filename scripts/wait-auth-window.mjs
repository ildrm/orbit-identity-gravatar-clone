import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL),
  deadline = Date.now() + 600000;
try {
  while (true) {
    let cursor = '0',
      remaining = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:auth:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys)
        if (Number(await redis.get(key)) > 0) remaining = Math.max(remaining, await redis.ttl(key));
    } while (cursor !== '0');
    if (remaining <= 0) break;
    if (Date.now() + remaining * 1000 > deadline)
      throw new Error('Authentication window did not become available within ten minutes.');
    console.log(
      'Waiting for the normal authentication window to expire (' + remaining + ' seconds).',
    );
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  }
  console.log('Authentication validation budget is available.');
} finally {
  await redis.quit();
}
