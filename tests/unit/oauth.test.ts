import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseAuthorization, matchesPkce, oauthRedirect } from '../../packages/core/src/oauth.js';
describe('OAuth request validation', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const request = {
    response_type: 'code',
    client_id: 'client',
    redirect_uri: 'https://example.com/callback',
    state: 'random-state-123456',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'identity.read profile.basic',
  };
  it('uses the RFC 7636 test vector and rejects a different verifier', () => {
    expect(matchesPkce(verifier, challenge)).toBe(true);
    expect(matchesPkce('a'.repeat(43), challenge)).toBe(false);
    expect(matchesPkce('short', challenge)).toBe(false);
  });
  it('requires an exact redirect and disallows a fragment, credentials or remote HTTP', () => {
    expect(() =>
      parseAuthorization({ ...request, redirect_uri: 'https://example.com/callback?next=evil' }, [
        request.redirect_uri,
      ]),
    ).toThrow();
    for (const url of [
      'https://example.com/#fragment',
      'https://u:p@example.com/callback',
      'http://example.com/callback',
      'javascript:alert(1)',
    ])
      expect(oauthRedirect.safeParse(url).success).toBe(false);
    expect(oauthRedirect.safeParse('http://127.0.0.1:12345/callback').success).toBe(true);
  });
  it('rejects implicit, PKCE downgrade, unknown scopes, and unscoped fields', () => {
    for (const patch of [
      { response_type: 'token' },
      { code_challenge_method: 'plain' },
      { state: 'short' },
      { scope: 'openid' },
      { fields: 'professional:employer' },
    ])
      expect(() => parseAuthorization({ ...request, ...patch }, [request.redirect_uri])).toThrow();
  });
  it('defaults to only the requested claim families and accepts selected fields', () => {
    const parsed = parseAuthorization(request, [request.redirect_uri]);
    expect(parsed.fields.every((k) => k.startsWith('core:') || k.startsWith('creator:'))).toBe(
      true,
    );
    expect(
      parseAuthorization({ ...request, fields: 'core:display_name' }, [request.redirect_uri])
        .fields,
    ).toEqual(['core:display_name']);
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
  });
});
