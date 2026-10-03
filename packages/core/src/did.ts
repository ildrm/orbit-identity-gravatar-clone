import { isIP } from 'node:net';
import { z } from 'zod';
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  compactVerify,
  decodeProtectedHeader,
  type JWK,
} from 'jose';
import { config } from './config.js';
import { query, type DB } from './db.js';
import { id, encrypt, decrypt } from './security.js';
import { DomainError } from './errors.js';
import { safeHttps } from './outbound.js';
export interface SigningKey {
  id: string;
  identity_id: string | null;
  public_jwk: JWK;
  private_encrypted: string;
  state: string;
}
export function nativeDid(identityId?: string): string {
  const origin = new URL(config().PUBLIC_ORIGIN);
  return (
    'did:web:' +
    origin.host.replaceAll(':', '%3A') +
    (identityId ? ':api:v1:dids:' + identityId : '')
  );
}
export function didUrl(did: string): string {
  if (!/^did:web:[A-Za-z0-9.%:_-]{1,1000}$/.test(did))
    throw new DomainError('UNSUPPORTED_DID', 'Only did:web resolution is supported.');
  const parts = did.slice(8).split(':'),
    host = decodeURIComponent(parts[0]!);
  const url = new URL('https://' + host);
  if (
    isIP(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    host !== url.host ||
    (url.port && url.port !== '443')
  )
    throw new DomainError('INVALID_DID', 'Use a DNS hostname and HTTPS port 443.');
  const path = parts.slice(1);
  if (path.some((p) => !p || p === '.' || p === '..' || !/^[-_A-Za-z0-9.]+$/.test(p)))
    throw new DomainError('INVALID_DID', 'Invalid DID path.');
  url.pathname = path.length ? '/' + path.join('/') + '/did.json' : '/.well-known/did.json';
  return url.href;
}
const jwkSchema = z
  .object({
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    alg: z.enum(['EdDSA', 'Ed25519']).optional(),
    use: z.literal('sig').optional(),
    kid: z.string().optional(),
  })
  .strict();
const methodSchema = z
  .object({
    id: z.string().max(1200),
    type: z.literal('JsonWebKey2020'),
    controller: z.string().max(1000),
    publicKeyJwk: jwkSchema,
  })
  .strict();
export const didDocumentSchema = z
  .object({
    id: z.string().max(1000),
    verificationMethod: z.array(methodSchema).min(1).max(20),
    authentication: z.array(z.string()).max(20).optional(),
    assertionMethod: z.array(z.string()).max(20).optional(),
  })
  .strict();
export function validateDidDocument(value: unknown, did: string) {
  const parsed = didDocumentSchema.safeParse(value);
  if (!parsed.success || parsed.data.id !== did)
    throw new DomainError('INVALID_DID_DOCUMENT', 'Unsupported or invalid DID JSON document.');
  const d = parsed.data,
    ids = new Set(d.verificationMethod.map((k) => k.id));
  if (
    ids.size !== d.verificationMethod.length ||
    d.verificationMethod.some((k) => k.controller !== did || !k.id.startsWith(did + '#')) ||
    [...(d.authentication ?? []), ...(d.assertionMethod ?? [])].some((k) => !ids.has(k))
  )
    throw new DomainError(
      'INVALID_DID_DOCUMENT',
      'DID verification methods must be controlled by the resolved DID.',
    );
  return d;
}
export async function resolveDid(did: string) {
  const localPrefix = nativeDid();
  if (did === localPrefix) return documentFor(null);
  const identityPrefix = localPrefix + ':api:v1:dids:';
  if (did.startsWith(identityPrefix) && /^idn_[a-f0-9]{32}$/.test(did.slice(identityPrefix.length)))
    return documentFor(did.slice(identityPrefix.length));
  const response = await safeHttps(didUrl(did), {
    maxBytes: 32768,
    headers: { Accept: 'application/did+json, application/json' },
  });
  if (response.status !== 200)
    throw new DomainError('DID_UNAVAILABLE', 'DID document unavailable.');
  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    throw new DomainError('INVALID_DID_DOCUMENT', 'DID document is not valid JSON.');
  }
  return validateDidDocument(value, did);
}
export async function createSigningKey(identityId: string | null, db: DB): Promise<SigningKey> {
  const [count] = await query<{ count: string }>(
    "SELECT count(*) FROM signing_keys WHERE identity_id IS NOT DISTINCT FROM $1 AND state<>'REVOKED'",
    [identityId],
    db,
  );
  if (Number(count!.count) >= 20)
    throw new DomainError('KEY_LIMIT', 'Revoke older verification keys before adding another.');
  const generated = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true }),
    keyId = id('key');
  const publicJwk = await exportJWK(generated.publicKey),
    privateJwk = await exportJWK(generated.privateKey);
  return (
    await query<SigningKey>(
      'INSERT INTO signing_keys(id,identity_id,public_jwk,private_encrypted) VALUES($1,$2,$3,$4) RETURNING *',
      [keyId, identityId, JSON.stringify(publicJwk), encrypt(JSON.stringify(privateJwk))],
      db,
    )
  )[0]!;
}
export async function privateSigningKey(key: SigningKey) {
  return importJWK(JSON.parse(decrypt(key.private_encrypted)) as JWK, 'EdDSA');
}
export async function documentFor(identityId: string | null) {
  if (
    identityId &&
    !(
      await query(
        "SELECT 1 FROM identities WHERE id=$1 AND did_enabled AND state NOT IN ('DELETED','SUSPENDED')",
        [identityId],
      )
    ).length
  )
    throw new DomainError('NOT_FOUND', 'DID unavailable.', 404);
  const did = nativeDid(identityId ?? undefined),
    keys = await query<SigningKey>(
      "SELECT id,public_jwk,state FROM signing_keys WHERE identity_id IS NOT DISTINCT FROM $1 AND state<>'REVOKED' ORDER BY created_at",
      [identityId],
    );
  if (!keys.length) throw new DomainError('NOT_FOUND', 'DID unavailable.', 404);
  return {
    id: did,
    verificationMethod: keys.map((k) => ({
      id: did + '#' + k.id,
      type: 'JsonWebKey2020' as const,
      controller: did,
      publicKeyJwk: k.public_jwk,
    })),
    authentication: keys.filter((k) => k.state === 'ACTIVE').map((k) => did + '#' + k.id),
    assertionMethod: keys.map((k) => did + '#' + k.id),
  };
}
export async function verifyDidSignature(
  token: string,
  did: string,
  purpose: 'authentication' | 'assertionMethod',
) {
  const header = decodeProtectedHeader(token),
    document = await resolveDid(did);
  if (
    header.alg !== 'EdDSA' ||
    typeof header.kid !== 'string' ||
    !document[purpose]?.includes(header.kid)
  )
    throw new DomainError('INVALID_PROOF', 'Signing key is not authorized by the DID.');
  const method = document.verificationMethod.find((k) => k.id === header.kid)!;
  const key = await importJWK(method.publicKeyJwk, 'EdDSA');
  const verified = await compactVerify(token, key, { algorithms: ['EdDSA'] });
  return {
    header: verified.protectedHeader,
    payload: JSON.parse(Buffer.from(verified.payload).toString('utf8')) as unknown,
    document,
  };
}
