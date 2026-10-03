import { seal, unseal } from './encryption.js';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
export function id(prefix: string): string {
  return prefix + '_' + randomBytes(16).toString('hex');
}
export function secret(): string {
  return randomBytes(32).toString('base64url');
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function keyring() {
  const c = config();
  return {
    activeId: c.ENCRYPTION_KEY_ID,
    activeKey: c.ENCRYPTION_KEY,
    previous: JSON.parse(c.ENCRYPTION_PREVIOUS_KEYS) as Record<string, string>,
    legacyKey: c.ENCRYPTION_LEGACY_KEY || undefined,
  };
}
export function encrypt(value: string): string {
  return seal(value, keyring());
}
export function decrypt(value: string): string {
  return unseal(value, keyring());
}
export function webhookSignature(key: string, timestamp: string, body: string): string {
  return createHmac('sha256', key)
    .update(timestamp + '.' + body)
    .digest('hex');
}
export function verifySignature(
  key: string,
  timestamp: string,
  body: string,
  signature: string,
  now = Date.now(),
): boolean {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(webhookSignature(key, timestamp, body), 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
