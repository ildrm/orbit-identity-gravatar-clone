await (await import('./delivery-cache-checks.mjs')).cacheChecks();
await (await import('../dist/packages/core/src/redis.js')).closeRedis();
