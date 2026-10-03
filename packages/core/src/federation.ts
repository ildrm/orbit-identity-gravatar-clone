import { blockedLinkHosts, safeClaimLinks } from './link-safety.js';
import { SignJWT, jwtVerify, decodeJwt, decodeProtectedHeader, importJWK } from 'jose';
import { z } from 'zod';
import { query, transaction, type DB } from './db.js';
import { config } from './config.js';
import { id, digest } from './security.js';
import { enqueue } from './events.js';
import { safeHttps } from './outbound.js';
import { approvedAttestation } from './federation-migration.js';
import { DomainError } from './errors.js';
import {
  createSigningKey,
  documentFor,
  nativeDid,
  privateSigningKey,
  validateDidDocument,
  type SigningKey,
} from './did.js';
interface Peer {
  id: string;
  origin: string;
  did: string;
  document: ReturnType<typeof validateDidDocument>;
  fingerprint: string;
  blocked_at: Date | null;
}
export async function nodeKey() {
  return transaction(async (db) => {
    await query('SELECT pg_advisory_xact_lock(718207)', [], db);
    return (
      (
        await query<SigningKey>(
          "SELECT * FROM signing_keys WHERE identity_id IS NULL AND state='ACTIVE'",
          [],
          db,
        )
      )[0] ?? (await createSigningKey(null, db))
    );
  });
}
export async function nodeDiscovery() {
  await nodeKey();
  const origin = config().PUBLIC_ORIGIN;
  return {
    protocol: 'orbit-federation',
    versions: ['1'],
    node: origin,
    issuer: nativeDid(),
    inbox: origin + '/api/v1/federation/inbox',
    document: await documentFor(null),
  };
}
export async function approvePeer(accountId: string, origin: string, fingerprint: string, db: DB) {
  const u = new URL(origin);
  if (
    u.origin !== origin ||
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    origin === config().PUBLIC_ORIGIN
  )
    throw new DomainError('INVALID_PEER', 'Choose another public HTTPS origin on port 443.');
  const response = await safeHttps(origin + '/.well-known/identity-federation', {
    maxBytes: 32768,
  });
  if (response.status !== 200)
    throw new DomainError('PEER_UNAVAILABLE', 'Peer discovery unavailable.');
  const info = z
    .object({
      protocol: z.literal('orbit-federation'),
      versions: z.array(z.string()).refine((v) => v.includes('1')),
      node: z.literal(origin),
      issuer: z.string(),
      inbox: z.literal(origin + '/api/v1/federation/inbox'),
      document: z.unknown(),
      fingerprint: z.string().optional(),
    })
    .strict()
    .parse(JSON.parse(response.body));
  const expectedDid = 'did:web:' + u.host.replaceAll(':', '%3A');
  if (info.issuer !== expectedDid)
    throw new DomainError('INVALID_PEER', 'Peer DID does not match its origin.');
  const document = validateDidDocument(info.document, expectedDid),
    actual = digest(JSON.stringify(document));
  if (actual !== fingerprint)
    throw new DomainError(
      'PEER_KEY_MISMATCH',
      'Confirm the discovered document fingerprint through your trusted operator channel.',
    );
  const existing = (
    await query<Peer>('SELECT * FROM federation_peers WHERE origin=$1 FOR UPDATE', [origin], db)
  )[0];
  if (existing && existing.fingerprint !== fingerprint && !existing.blocked_at)
    throw new DomainError(
      'PEER_KEY_CHANGED',
      'Block and review peer key rotation before replacing the pinned document.',
      409,
    );
  await query(
    'INSERT INTO federation_peers(id,origin,did,document,fingerprint,approved_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(origin) DO UPDATE SET document=EXCLUDED.document,fingerprint=EXCLUDED.fingerprint,blocked_at=NULL,approved_by=EXCLUDED.approved_by,approved_at=now()',
    [id('peer'), origin, info.issuer, JSON.stringify(document), actual, accountId],
    db,
  );
}
export async function queueFederation(payload: Record<string, unknown>, db: DB) {
  if (typeof payload.identityId !== 'string' || typeof payload.id !== 'string') return;
  const [identity] = await query<{ federation_enabled: boolean }>(
    'SELECT federation_enabled FROM identities WHERE id=$1',
    [payload.identityId],
    db,
  );
  const previouslyPublished = (
    await query(
      'SELECT 1 FROM federation_outbox WHERE identity_id=$1 LIMIT 1',
      [payload.identityId],
      db,
    )
  ).length;
  if (!identity?.federation_enabled && !previouslyPublished) return;
  const [outbox] = await query<{ id: string; sequence: string }>(
    'INSERT INTO federation_outbox(id,identity_id,event_id) VALUES($1,$2,$3) ON CONFLICT(event_id) DO NOTHING RETURNING id,sequence',
    [id('fmsg'), payload.identityId, payload.id],
    db,
  );
  if (!outbox) return;
  const peers = await query<{ id: string }>(
    'SELECT id FROM federation_peers WHERE blocked_at IS NULL',
    [],
    db,
  );
  for (const peer of peers)
    await enqueue(db, 'federation', {
      peerId: peer.id,
      outboxId: outbox.id,
      identityId: payload.identityId,
      deliveryId: id('fmsg'),
    });
}
export async function federationProjection(identityId: string) {
  const [i] = await query<{ id: string; handle: string; type: string; revision: number }>(
    "SELECT id,handle,type,revision FROM identities WHERE id=$1 AND state='ACTIVE' AND visibility='PUBLIC' AND machine AND federation_enabled",
    [identityId],
  );
  if (!i) return null;
  const claims = await query<{
    id: string;
    key: string;
    value: unknown;
    locale: string;
    source: string;
    verification: string;
  }>(
    "SELECT c.id,c.key,CASE WHEN policy->>'transformation'='FULL' THEN value WHEN policy->>'transformation' IN ('GENERALIZED','ALIAS') THEN to_jsonb(policy->>'disclosedValue') WHEN policy->>'transformation'='REDACTED' THEN to_jsonb('Redacted'::text) ELSE NULL END AS value,locale,source,verification_state AS verification FROM claims c WHERE identity_id=$1 AND persona_id IS NULL AND selected AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND policy->>'visibility'='PUBLIC' AND policy->>'machine'='true' AND policy->>'transformation'<>'HIDDEN' AND (assertion_id IS NULL OR EXISTS(SELECT 1 FROM enterprise_assertions a JOIN identities issuer ON issuer.id=a.issuer_id WHERE a.id=c.assertion_id AND a.state='ACCEPTED' AND a.revoked_at IS NULL AND a.expires_at>now() AND issuer.state='ACTIVE')) ORDER BY key LIMIT 100",
    [identityId],
  );
  const blocked = await blockedLinkHosts();
  for (const c of claims) c.value = safeClaimLinks(c.key, c.value, blocked);
  const display = claims.find((c) => c.key === 'core:display_name')?.value;
  return {
    id: i.id,
    handle: i.handle,
    type: i.type,
    revision: i.revision,
    displayName: typeof display === 'string' ? display : i.handle,
    claims,
    avatarUrl: config().PUBLIC_ORIGIN + '/avatar/' + i.id,
  };
}
export async function sendFederation(payload: Record<string, unknown>) {
  const peer = (
    await query<Peer>('SELECT * FROM federation_peers WHERE id=$1 AND blocked_at IS NULL', [
      payload.peerId,
    ])
  )[0];
  if (!peer) return;
  const outbox = (
    await query<{ sequence: string; identity_id: string }>(
      'SELECT sequence,identity_id FROM federation_outbox WHERE id=$1',
      [payload.outboxId],
    )
  )[0];
  if (!outbox) return;
  const projection = await federationProjection(outbox.identity_id),
    root = config().PUBLIC_ORIGIN,
    key = await nodeKey(),
    messageId = String(payload.deliveryId);
  const migration = (
    await query<{ migrated_to: string; migrated_at: Date; migration_proof: string }>(
      "SELECT migrated_to,migrated_at,migration_proof FROM identities WHERE id=$1 AND state='TRANSFERRED'",
      [outbox.identity_id],
    )
  )[0];
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: root + '/api/v1/federation/messages/' + messageId,
    type: migration ? 'Move' : projection ? 'Update' : 'Delete',
    actor: root + '/api/v1/profiles/' + outbox.identity_id,
    object: migration
      ? {
          target: migration.migrated_to,
          proof: migration.migration_proof,
          movedAt: new Date(migration.migrated_at).toISOString(),
        }
      : projection,
  };
  const token = await new SignJWT({ protocol: '1', sequence: Number(outbox.sequence), activity })
    .setProtectedHeader({
      alg: 'EdDSA',
      typ: 'orbit-federation+jwt',
      kid: nativeDid() + '#' + key.id,
    })
    .setIssuer(nativeDid())
    .setAudience(peer.origin)
    .setJti(messageId)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(await privateSigningKey(key));
  if (
    !(
      await query(
        'SELECT 1 FROM federation_peers WHERE id=$1 AND fingerprint=$2 AND blocked_at IS NULL',
        [peer.id, peer.fingerprint],
      )
    ).length
  )
    return;
  const response = await safeHttps(peer.origin + '/api/v1/federation/inbox', {
    method: 'POST',
    body: JSON.stringify({ message: token }),
    headers: { 'Content-Type': 'application/json' },
    maxBytes: 4096,
  });
  if (response.status < 200 || response.status >= 300)
    throw new DomainError('FEDERATION_DELIVERY_FAILED', 'Peer rejected the signed update.', 502);
}
export async function receiveFederation(message: string) {
  let issuer: string | undefined;
  try {
    issuer = decodeJwt(message).iss;
  } catch {
    throw new DomainError('INVALID_FEDERATION_MESSAGE', 'Invalid signed message.');
  }
  const peer = (
    await query<Peer>('SELECT * FROM federation_peers WHERE did=$1 AND blocked_at IS NULL', [
      issuer,
    ])
  )[0];
  if (!peer) throw new DomainError('UNTRUSTED_PEER', 'Peer is not approved.', 403);
  const header = decodeProtectedHeader(message),
    key = peer.document.verificationMethod.find((k) => k.id === header.kid);
  if (
    !key ||
    header.alg !== 'EdDSA' ||
    header.typ !== 'orbit-federation+jwt' ||
    !peer.document.assertionMethod?.includes(key.id)
  )
    throw new DomainError('INVALID_FEDERATION_SIGNATURE', 'Untrusted signing key.', 403);
  let payload: Record<string, unknown>;
  try {
    payload = (
      await jwtVerify(message, await importJWK(key.publicKeyJwk, 'EdDSA'), {
        algorithms: ['EdDSA'],
        issuer: peer.did,
        audience: config().PUBLIC_ORIGIN,
        clockTolerance: 30,
        requiredClaims: ['iat', 'exp', 'jti', 'iss', 'aud'],
      })
    ).payload;
  } catch {
    throw new DomainError(
      'INVALID_FEDERATION_SIGNATURE',
      'Signature, audience or expiry validation failed.',
      403,
    );
  }
  const d = z
    .object({
      protocol: z.literal('1'),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      iss: z.literal(peer.did),
      aud: z.literal(config().PUBLIC_ORIGIN),
      iat: z.number().int(),
      exp: z.number().int(),
      jti: z.string().regex(/^fmsg_[a-f0-9]{32}$/),
      activity: z
        .object({
          '@context': z.literal('https://www.w3.org/ns/activitystreams'),
          id: z.string(),
          type: z.enum(['Update', 'Delete', 'Move']),
          actor: z.string().max(2048),
          object: z.unknown(),
        })
        .strict(),
    })
    .strict()
    .parse(payload);
  const now = Math.floor(Date.now() / 1000);
  if (
    d.iat > now + 30 ||
    d.iat < now - 180 ||
    d.exp > d.iat + 180 ||
    d.exp <= d.iat ||
    d.activity.id !== peer.origin + '/api/v1/federation/messages/' + d.jti
  )
    throw new DomainError('INVALID_FEDERATION_MESSAGE', 'Invalid timestamp or message identity.');
  const actorPrefix = peer.origin + '/api/v1/profiles/',
    remoteId = d.activity.actor.slice(actorPrefix.length);
  if (!d.activity.actor.startsWith(actorPrefix) || !/^idn_[a-f0-9]{32}$/.test(remoteId))
    throw new DomainError('INVALID_REMOTE_IDENTITY', 'A node may only update its own identities.');
  let projection: unknown = null,
    movedTo: string | null = null,
    destinationApproval: { origin: string; fingerprint: string } | null = null;
  if (d.activity.type === 'Move') {
    const move = z
      .object({
        target: z.url().max(2048),
        proof: z.string().max(16000),
        movedAt: z.iso.datetime(),
      })
      .strict()
      .parse(d.activity.object);
    const at = new Date(move.movedAt);
    if (at.getTime() > Date.now() + 30000)
      throw new DomainError('INVALID_MIGRATION_PROOF', 'Migration date is in the future.');
    const attestation = await approvedAttestation(
      move.proof,
      new URL(move.target).origin,
      at,
      undefined,
      peer.origin,
    );
    if (attestation.source !== d.activity.actor || attestation.target !== move.target)
      throw new DomainError('INVALID_MIGRATION_PROOF', 'Destination did not accept this source.');
    movedTo = move.target;
    destinationApproval = {
      origin: new URL(move.target).origin,
      fingerprint: attestation.peerFingerprint,
    };
  }
  if (d.activity.type === 'Update') {
    const object = z
      .object({
        id: z.literal(remoteId),
        handle: z.string().regex(/^[a-z][a-z0-9_]{2,29}$/),
        type: z.string().max(30),
        revision: z.number().int().positive(),
        displayName: z.string().max(120),
        claims: z
          .array(
            z
              .object({
                id: z.string().max(100),
                key: z.string().max(100),
                value: z.unknown(),
                locale: z.string().max(30),
                source: z.string().max(80),
                verification: z.string().max(80),
              })
              .strict(),
          )
          .max(100),
        avatarUrl: z.literal(peer.origin + '/avatar/' + remoteId),
      })
      .strict()
      .parse(d.activity.object);
    if (JSON.stringify(object).length > 30000)
      throw new DomainError('REMOTE_PROFILE_TOO_LARGE', 'Remote profile exceeds the size limit.');
    projection = object;
  } else if (d.activity.type === 'Delete' && d.activity.object !== null)
    throw new DomainError('INVALID_FEDERATION_MESSAGE', 'Delete messages contain no profile data.');
  return transaction(async (db) => {
    const currentPeer = (
      await query<Peer>(
        'SELECT * FROM federation_peers WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',
        [peer.id],
        db,
      )
    )[0];
    if (!currentPeer || currentPeer.fingerprint !== peer.fingerprint)
      throw new DomainError('UNTRUSTED_PEER', 'Peer approval changed.', 403);
    if (
      destinationApproval &&
      !(
        await query(
          'SELECT 1 FROM federation_peers WHERE origin=$1 AND fingerprint=$2 AND blocked_at IS NULL FOR SHARE',
          [destinationApproval.origin, destinationApproval.fingerprint],
          db,
        )
      ).length
    )
      throw new DomainError('UNTRUSTED_PEER', 'Destination approval changed.', 403);
    const receipts = await query(
      'INSERT INTO federation_receipts(peer_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',
      [peer.id, d.jti],
      db,
    );
    if (!receipts.length) return { accepted: true, duplicate: true };
    const existing = (
      await query<{ sequence: string; state: string }>(
        'SELECT sequence,state FROM remote_profiles WHERE actor=$1 FOR UPDATE',
        [d.activity.actor],
        db,
      )
    )[0];
    if (existing && Number(existing.sequence) >= d.sequence) return { accepted: true, stale: true };
    if (existing?.state === 'MOVED') return { accepted: true, stale: true };
    await query(
      "INSERT INTO remote_profiles(actor,peer_id,sequence,profile,state,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '24 hours') ON CONFLICT(actor) DO UPDATE SET sequence=EXCLUDED.sequence,profile=EXCLUDED.profile,state=EXCLUDED.state,expires_at=EXCLUDED.expires_at,updated_at=now()",
      [
        d.activity.actor,
        peer.id,
        d.sequence,
        projection ? JSON.stringify(projection) : null,
        projection ? 'ACTIVE' : 'DELETED',
      ],
      db,
    );
    if (movedTo)
      await query(
        "UPDATE remote_profiles SET state='MOVED',profile=NULL,moved_to=$2 WHERE actor=$1",
        [d.activity.actor, movedTo],
        db,
      );
    return { accepted: true };
  });
}
