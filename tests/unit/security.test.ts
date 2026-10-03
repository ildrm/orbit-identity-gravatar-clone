import { describe, it, expect } from 'vitest';
import { generatedAvatar } from '../../packages/core/src/avatar.js';
import { publicAddress } from '../../packages/core/src/outbound.js';
import {
  webhookSignature,
  verifySignature,
  id,
  secret,
  digest,
} from '../../packages/core/src/security.js';
describe('security and safe delivery', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::1',
    '3fff::1',
  ])('blocks non-public outbound address %s', (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it('permits public addresses', () => {
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('validates webhook signature, timestamp and payload', () => {
    const key = secret(),
      body = '{"id":"evt"}',
      timestamp = String(Math.floor(Date.now() / 1000)),
      sig = webhookSignature(key, timestamp, body);
    expect(verifySignature(key, timestamp, body, sig)).toBe(true);
    expect(verifySignature(key, timestamp, body + ' ', sig)).toBe(false);
    expect(verifySignature(key, '1', body, sig)).toBe(false);
    expect(verifySignature(key, timestamp, body, 'invalid')).toBe(false);
  });
  it('produces stable original SVG without injected markup', () => {
    const avatar = generatedAvatar('<script>alert(1)</script>', 128, 'initials');
    expect(avatar).not.toContain('<script>');
    expect(generatedAvatar('seed')).toBe(generatedAvatar('seed'));
    expect(generatedAvatar('seed')).not.toBe(generatedAvatar('other'));
    expect(() => generatedAvatar('seed', 100000)).toThrow();
    expect(() => generatedAvatar('seed', 128, 'geometric', 'red"><script>')).toThrow();
  });
  it('uses opaque random identifiers and one-way digests', () => {
    const a = id('idn'),
      b = id('idn');
    expect(a).toMatch(/^idn_[a-f0-9]{32}$/);
    expect(a).not.toBe(b);
    expect(digest(secret())).toHaveLength(64);
  });
});
