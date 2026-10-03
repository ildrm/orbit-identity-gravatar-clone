import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { check } from './test-client.mjs';
export async function cacheChecks() {
  const { deliveryProjection, beginDeliveryWrite, endDeliveryWrite } =
      await import('../dist/packages/core/src/delivery-cache.js'),
    { redis } = await import('../dist/packages/core/src/redis.js');
  const key = 'fixture-cache-' + randomBytes(12).toString('hex'),
    r = redis();
  let reads = 0,
    value = 'public',
    boundary = Date.now() + 10_000;
  const load = async () => {
      reads++;
      return { value, validUntil: boundary };
    },
    read = () => deliveryProjection(key, load);
  assert.equal(await read(), 'public');
  assert.equal(await read(), 'public');
  check(reads === 1, 'A warm delivery projection performs no loader or database read');
  await beginDeliveryWrite();
  value = 'private';
  check(
    (await read()) === 'private' && reads === 2,
    'A pending privacy write bypasses the previously warm projection',
  );
  await endDeliveryWrite();
  assert.equal(await read(), 'private');
  const warmReads = reads;
  await read();
  check(reads === warmReads, 'A committed privacy change replaces the old cached projection');
  await beginDeliveryWrite();
  await beginDeliveryWrite();
  await endDeliveryWrite();
  value = 'concurrent';
  check(
    (await read()) === 'concurrent',
    'An unfinished concurrent writer continues to bypass the cache',
  );
  await endDeliveryWrite();
  await read();
  boundary = Date.now() + 120;
  await beginDeliveryWrite();
  await endDeliveryWrite();
  await read();
  value = 'expired';
  await new Promise((r) => setTimeout(r, 150));
  check((await read()) === 'expired', 'Projection cache expires at the exact temporal boundary');
  boundary = Date.now() + 10_000;
  await read();
  const cacheKey = 'delivery:projection:' + createHash('sha256').update(key).digest('hex');
  await r.set(cacheKey, '{corrupted', 'PX', 1000);
  value = 'rebuilt';
  check((await read()) === 'rebuilt', 'Malformed cached projection is discarded and rebuilt');
  const prior = reads;
  const ended = new Promise((resolve) => r.once('end', resolve));
  r.disconnect();
  await ended;
  await r.connect();
  await read();
  check(reads > prior, 'A real Redis reconnect invalidates earlier projection generations');
  await r.del(cacheKey);
}
