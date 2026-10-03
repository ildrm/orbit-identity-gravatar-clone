import { query, type DB } from './db.js';
import { enqueue, event } from './events.js';
export async function purgeIdentity(
  db: DB,
  identityId: string,
  actorId: string,
  requestId: string,
): Promise<void> {
  await query(
    "UPDATE identities SET state='DELETED',visibility='PRIVATE',searchable=false,indexable=false,avatar_media_id=NULL,header_media_id=NULL,federation_enabled=false,did_enabled=false,contact_enabled=false,machine=false,agent=false WHERE id=$1",
    [identityId],
    db,
  );
  await query('UPDATE consents SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
  await query('UPDATE domains SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM claims WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM revisions WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM profile_blocks WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM analytics_daily WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM web_proofs WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM imports WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM notifications WHERE identity_id=$1', [identityId], db);
  await query('UPDATE legacy_policies SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
  await query(
    "UPDATE legacy_requests SET evidence_encrypted='',state=CASE WHEN state IN ('PENDING','APPROVED') THEN 'VETOED' ELSE state END WHERE identity_id=$1",
    [identityId],
    db,
  );
  await query(
    "UPDATE enterprise_assertions SET state='REVOKED',revoked_at=now(),value='null',dispute_reason=NULL WHERE issuer_id=$1 OR subject_id=$1",
    [identityId],
    db,
  );
  await query(
    "UPDATE credentials SET revoked_at=now(),token_encrypted='' WHERE issuer_id=$1 OR subject_id=$1",
    [identityId],
    db,
  );
  await query(
    "UPDATE signing_keys SET state='REVOKED',revoked_at=now(),private_encrypted='' WHERE identity_id=$1",
    [identityId],
    db,
  );
  await query('DELETE FROM did_associations WHERE identity_id=$1', [identityId], db);
  await query(
    "UPDATE identity_merges SET source_snapshot='{}',target_snapshot='{}' WHERE source_id=$1 OR target_id=$1",
    [identityId],
    db,
  );
  await query(
    'UPDATE relationships SET revoked_at=now() WHERE source_id=$1 OR target_id=$1',
    [identityId],
    db,
  );
  await query('UPDATE qr_codes SET revoked_at=now() WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM avatar_selections WHERE identity_id=$1', [identityId], db);
  await query('UPDATE personas SET avatar_media_id=NULL WHERE identity_id=$1', [identityId], db);
  await query(
    "UPDATE media SET status='DELETED',public_enabled=false WHERE identity_id=$1",
    [identityId],
    db,
  );
  await query(
    "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE identity_id=$1",
    [identityId],
    db,
  );
  await query('DELETE FROM contact_messages WHERE identity_id=$1', [identityId], db);
  await query('DELETE FROM contact_blocks WHERE identity_id=$1', [identityId], db);
  await query(
    "UPDATE jobs SET status='COMPLETED',completed_at=now(),payload='{}',lease_token=NULL WHERE payload->>'identityId'=$1 AND kind IN ('relay','export','media')",
    [identityId],
    db,
  );
  await query("UPDATE exports SET status='CANCELLED' WHERE identity_id=$1", [identityId], db);
  await query('DELETE FROM invitations WHERE identity_id=$1', [identityId], db);
  await enqueue(db, 'delete-media', { identityId });
  await event(db, identityId, actorId, 'identity.deleted', requestId);
}
