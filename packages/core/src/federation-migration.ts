import { jwtVerify, decodeProtectedHeader, importJWK, type JWTPayload } from 'jose';
import { z } from 'zod';
import { query, type DB } from './db.js';
import { config } from './config.js';
import { DomainError, requireValue } from './errors.js';
import { validateDidDocument } from './did.js';
export async function approvedAttestation(
  token: string,
  origin: string,
  at: Date = new Date(),
  db?: DB,
  audience = config().PUBLIC_ORIGIN,
) {
  const peer = requireValue(
    (
      await query<{ did: string; document: unknown; fingerprint: string }>(
        'SELECT did,document,fingerprint FROM federation_peers WHERE origin=$1 AND blocked_at IS NULL',
        [origin],
        db,
      )
    )[0],
    'Destination node is not approved',
  );
  const document = validateDidDocument(peer.document, peer.did),
    header = decodeProtectedHeader(token),
    key = document.verificationMethod.find((k) => k.id === header.kid);
  if (
    !key ||
    header.alg !== 'EdDSA' ||
    header.typ !== 'orbit-migration+jwt' ||
    !document.assertionMethod?.includes(key.id)
  )
    throw new DomainError('INVALID_MIGRATION_PROOF', 'Destination signing key is untrusted.', 403);
  let payload: JWTPayload;
  try {
    payload = (
      await jwtVerify(token, await importJWK(key.publicKeyJwk, 'EdDSA'), {
        issuer: peer.did,
        audience,
        algorithms: ['EdDSA'],
        clockTolerance: 30,
        currentDate: at,
        requiredClaims: ['iat', 'exp', 'jti', 'aud', 'iss'],
      })
    ).payload;
  } catch {
    throw new DomainError(
      'INVALID_MIGRATION_PROOF',
      'Destination signature, audience or expiry validation failed.',
    );
  }
  const proof = z
    .object({
      iss: z.literal(peer.did),
      aud: z.literal(audience),
      iat: z.number().int(),
      exp: z.number().int(),
      jti: z.string().regex(/^mig_[a-f0-9]{32}$/),
      source: z.url(),
      target: z.url(),
      nonce: z.string().min(20).max(200),
    })
    .strict()
    .parse(payload);
  if (
    proof.iat > at.getTime() / 1000 + 30 ||
    proof.iat < at.getTime() / 1000 - 600 ||
    proof.exp > proof.iat + 600 ||
    proof.target !== origin + '/api/v1/profiles/' + proof.target.split('/').at(-1) ||
    !/^idn_[a-f0-9]{32}$/.test(proof.target.split('/').at(-1)!)
  )
    throw new DomainError('INVALID_MIGRATION_PROOF', 'Invalid migration binding or timestamp.');
  return { ...proof, peerFingerprint: peer.fingerprint };
}
