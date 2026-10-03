import { describe, it, expect } from 'vitest';
import { seal, unseal } from '../packages/core/src/encryption';
import { randomBytes, createCipheriv } from 'node:crypto';
describe('encryption key rotation', () => {
  const first = { activeId: 'first', activeKey: 'a'.repeat(64), previous: {} },
    second = {
      activeId: 'second',
      activeKey: 'b'.repeat(64),
      previous: { first: first.activeKey },
      legacyKey: first.activeKey,
    };
  it('preserves old ciphertext through rotation and uses fresh nonces', () => {
    const old = seal('private provider token', first);
    expect(unseal(old, second)).toBe('private provider token');
    expect(seal('same', second)).not.toBe(seal('same', second));
    expect(seal('new', second)).toMatch(/^enc1:second:/);
  });
  it('rejects key ID tampering, unknown keys and modified ciphertext', () => {
    const token = seal('private', first);
    expect(() => unseal(token.replace(':first:', ':second:'), second)).toThrow();
    expect(() => unseal(token, { ...second, previous: {} })).toThrow();
    const b = Buffer.from(token.split(':')[2]!, 'base64');
    b[12] = b[12]! ^ 1;
    expect(() => unseal('enc1:first:' + b.toString('base64'), second)).toThrow();
  });
  it('supports legacy envelopes with an explicit legacy key', () => {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', Buffer.from(first.activeKey, 'hex'), nonce),
      legacy = Buffer.concat([
        nonce,
        cipher.update('legacy secret'),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString('base64');
    expect(unseal(legacy, second)).toBe('legacy secret');
  });
});
