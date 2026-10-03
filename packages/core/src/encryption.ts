import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export interface Keyring {
  activeId: string;
  activeKey: string;
  previous: Record<string, string>;
  legacyKey?: string;
}
function key(value: string | undefined) {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Encryption key unavailable');
  return Buffer.from(value, 'hex');
}
export function seal(value: string, ring: Keyring): string {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(ring.activeId)) throw new Error('Invalid key identifier');
  const nonce = randomBytes(12),
    header = 'enc1:' + ring.activeId,
    cipher = createCipheriv('aes-256-gcm', key(ring.activeKey), nonce);
  cipher.setAAD(Buffer.from(header));
  return (
    header +
    ':' +
    Buffer.concat([
      nonce,
      cipher.update(value, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64')
  );
}
export function unseal(value: string, ring: Keyring): string {
  const fields = value.split(':'),
    modern = fields.length === 3 && fields[0] === 'enc1',
    keyId = modern ? fields[1] : undefined;
  if (fields.length !== 1 && !modern) throw new Error('Invalid encrypted envelope');
  const selected = modern
      ? keyId === ring.activeId
        ? ring.activeKey
        : ring.previous[keyId!]
      : (ring.legacyKey ?? ring.activeKey),
    b = Buffer.from(modern ? fields[2]! : value, 'base64');
  if (b.length < 28) throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key(selected), b.subarray(0, 12));
  if (modern) decipher.setAAD(Buffer.from(fields[0] + ':' + keyId));
  decipher.setAuthTag(b.subarray(-16));
  return Buffer.concat([decipher.update(b.subarray(12, -16)), decipher.final()]).toString('utf8');
}
