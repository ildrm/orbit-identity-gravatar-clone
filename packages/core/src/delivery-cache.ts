import { randomUUID, createHash } from 'node:crypto';
import { redis, connectRedis } from './redis.js';
export const deliveryCacheStats = { hit: 0, miss: 0, bypass: 0 };
const epochKey = 'delivery:epoch',
  writersKey = 'delivery:writers';
let listening = false,
  ready: Promise<unknown> = Promise.resolve();
async function client() {
  const r = redis();
  if (!listening) {
    listening = true;
    const rotate = () => {
      ready = r.set(epochKey, randomUUID());
      ready.catch(() => {});
    };
    r.on('ready', rotate);
    if (r.status === 'ready') rotate();
  }
  await connectRedis();
  await ready;
  return r;
}
/** A durable fence has no expiry. A crashed writer forces SQL reads until maintenance reconciliation. */
export async function beginDeliveryWrite(): Promise<void> {
  const r = await client();
  await r.eval(
    "redis.call('SET',KEYS[1],ARGV[1]);redis.call('INCR',KEYS[2]);return 1",
    2,
    epochKey,
    writersKey,
    randomUUID(),
  );
}
export async function endDeliveryWrite(): Promise<void> {
  const r = await client();
  await r.eval(
    "redis.call('SET',KEYS[1],ARGV[1]);local n=tonumber(redis.call('GET',KEYS[2]) or '0');if n>1 then redis.call('DECR',KEYS[2]) else redis.call('DEL',KEYS[2]) end;return 1",
    2,
    epochKey,
    writersKey,
    randomUUID(),
  );
}
export interface Projection<T> {
  value: T;
  validUntil: number;
}
export async function deliveryProjection<T>(
  key: string,
  load: () => Promise<Projection<T>>,
): Promise<T> {
  if (process.env.DELIVERY_CACHE === 'false') return (await load()).value;
  const r = await client(),
    [epoch, writers] = await r.mget(epochKey, writersKey),
    cacheKey = 'delivery:projection:' + createHash('sha256').update(key).digest('hex');
  if (Number(writers ?? 0) > 0 || !epoch) {
    deliveryCacheStats.bypass++;
    return (await load()).value;
  }
  const cached = await r.get(cacheKey);
  if (cached) {
    try {
      const d = JSON.parse(cached) as Projection<T> & { epoch: string };
      if (d.epoch === epoch && d.validUntil > Date.now()) {
        deliveryCacheStats.hit++;
        return d.value;
      }
    } catch {}
  }
  deliveryCacheStats.miss++;
  const data = await load(),
    ttl = Math.floor(Math.min(15_000, data.validUntil - Date.now()));
  if (ttl > 0)
    await r.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] and tonumber(redis.call('GET',KEYS[2]) or '0')==0 then redis.call('SET',KEYS[3],ARGV[2],'PX',ARGV[3]);return 1 end;return 0",
      3,
      epochKey,
      writersKey,
      cacheKey,
      epoch,
      JSON.stringify({ ...data, epoch }),
      ttl,
    );
  return data.value;
}
