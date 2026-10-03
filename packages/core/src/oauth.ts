import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { scopes, claimKeys } from '../../contracts/src/index.js';
import { scopeForClaim } from './policy.js';
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export const oauthScopes = [...scopes, 'offline_access'] as const;
export const oauthRedirect = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (
        !u.username &&
        !u.password &&
        !u.hash &&
        (u.protocol === 'https:' ||
          (u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))
      );
    } catch {
      return false;
    }
  }, 'Use HTTPS, or a literal loopback IP for a local client, without credentials or fragments.');
export const oauthClientSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(500),
    redirectUris: z.array(oauthRedirect).min(1).max(10),
    mode: z.enum(['PUBLIC', 'CONFIDENTIAL']),
  })
  .strict();
export const oauthDecisionSchema = z
  .object({
    approve: z.boolean(),
    identityId: z.string().max(100).optional(),
    personaId: z.string().max(100).nullable().default(null),
    scopes: z.array(z.string().max(80)).max(10).default([]),
    fields: z.array(z.string().max(100)).max(30).default([]),
    shareEmail: z.boolean().default(false),
    days: z.number().int().min(1).max(365).default(30),
  })
  .strict();
export function parseAuthorization(input: Record<string, unknown>, redirects: string[]) {
  const parsed = z
    .object({
      response_type: z.literal('code'),
      client_id: z.string().min(1).max(100),
      redirect_uri: oauthRedirect,
      state: z.string().min(16).max(512),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      code_challenge_method: z.literal('S256'),
      scope: z.string().max(500).default('identity.read profile.basic'),
      fields: z.string().max(2000).optional(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    throw new OAuthError(
      'invalid_request',
      'Use an authorization code request with state and S256 PKCE.',
    );
  const d = parsed.data;
  if (!redirects.includes(d.redirect_uri))
    throw new OAuthError(
      'invalid_request',
      'Redirect URI does not exactly match the registered URI.',
    );
  const requested = [...new Set(d.scope.split(' ').filter(Boolean))];
  if (
    !requested.length ||
    requested.some((s) => !oauthScopes.includes(s as (typeof oauthScopes)[number]))
  )
    throw new OAuthError('invalid_scope', 'One or more scopes are unsupported.');
  const fields =
    d.fields === undefined
      ? claimKeys.filter((k) => requested.includes(scopeForClaim(k)))
      : [...new Set(d.fields.split(' ').filter(Boolean))];
  if (
    fields.some(
      (k) =>
        (!(claimKeys as readonly string[]).includes(k) &&
          !/^credential:vcr_[a-f0-9]{32}$/.test(k)) ||
        !requested.includes(scopeForClaim(k)),
    )
  )
    throw new OAuthError('invalid_scope', 'Requested fields must belong to the requested scopes.');
  return { ...d, scopes: requested, fields };
}
export function matchesPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = createHash('sha256').update(verifier).digest('base64url');
  return (
    actual.length === challenge.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(challenge))
  );
}
export function matchesSecret(value: string, expected: string | null): boolean {
  const actual = createHash('sha256').update(value).digest('hex');
  return (
    !!expected &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
