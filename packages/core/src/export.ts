import { query, transaction } from './db.js';
import { putObject, deleteObject } from './storage.js';
import { uploadArchive } from './archive.js';
import { event } from './events.js';
import { decrypt } from './security.js';
export async function exportIdentity(payload: Record<string, unknown>) {
  const identityId = String(payload.identityId),
    exportId = String(payload.exportId);
  const e = (
    await query<{ status: string; account_id: string }>(
      "SELECT status,account_id FROM exports WHERE id=$1 AND expires_at>now() AND status='PENDING'",
      [exportId],
    )
  )[0];
  if (!e) return;
  const bundle = await transaction(async (db) => {
    await query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', [], db);
    const identity = (
      await query<Record<string, unknown>>(
        "SELECT * FROM identities WHERE id=$1 AND state NOT IN ('DELETED','MERGED')",
        [identityId],
        db,
      )
    )[0];
    if (!identity) return null;
    if (
      !(
        await query(
          "SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.identity_id=$1 AND m.account_id=$2 AND m.role='OWNER' AND a.state='ACTIVE'",
          [identityId, e.account_id],
          db,
        )
      ).length
    )
      return null;
    const result: Record<string, unknown> = {
      manifest: {
        schemaVersion: '2.0',
        exportedAt: new Date().toISOString(),
        identityId,
        format: 'orbit-identity',
        media:
          'Validated sources and derivatives in the accompanying tar.gz archive. Private holder credentials included; account authentication and application secrets excluded.',
      },
      identity,
    };
    for (const table of [
      'personas',
      'claims',
      'media',
      'avatar_selections',
      'profile_blocks',
      'web_proofs',
      'did_associations',
      'domains',
      'qr_codes',
      'analytics_daily',
    ])
      result[table] = await query(
        'SELECT * FROM ' + table + ' WHERE identity_id=$1',
        [identityId],
        db,
      );
    result.relationships = await query(
      'SELECT * FROM relationships WHERE source_id=$1 OR target_id=$1',
      [identityId],
      db,
    );
    result.verification = await query(
      'SELECT * FROM enterprise_assertions WHERE subject_id=$1 OR issuer_id=$1',
      [identityId],
      db,
    );
    result.providers = await query(
      'SELECT id,provider,provider_id,fields,last_synced_at,last_error,revoked_at FROM provider_connections WHERE identity_id=$1',
      [identityId],
      db,
    );
    result.consents = await query(
      'SELECT id,application_id,persona_id,scopes,fields,purpose,protocol,granted_at,expires_at,revoked_at FROM consents WHERE identity_id=$1',
      [identityId],
      db,
    );
    result.credentials = (
      await query<Record<string, unknown> & { token_encrypted: string }>(
        'SELECT * FROM credentials WHERE subject_id=$1',
        [identityId],
        db,
      )
    ).map(({ token_encrypted, ...c }) => ({
      ...c,
      credential: token_encrypted ? decrypt(token_encrypted) : null,
    }));
    return result;
  });
  if (!bundle) {
    await query("UPDATE exports SET status='CANCELLED' WHERE id=$1", [exportId]);
    return;
  }
  const prefix = 'exports/' + identityId + '/' + exportId,
    key = prefix + '.json',
    archiveKey = prefix + '.tar.gz';
  const entries: { path: string; data?: Buffer; objectKey?: string }[] = [
    { path: 'manifest.json', data: Buffer.from(JSON.stringify(bundle.manifest, null, 2)) },
    { path: 'identity.json', data: Buffer.from(JSON.stringify(bundle.identity, null, 2)) },
    { path: 'bundle.json', data: Buffer.from(JSON.stringify(bundle, null, 2)) },
  ];
  for (const table of [
    'personas',
    'claims',
    'relationships',
    'credentials',
    'verification',
    'profile_blocks',
    'domains',
    'providers',
    'consents',
  ])
    entries.push({
      path: table + '/records.json',
      data: Buffer.from(JSON.stringify(bundle[table], null, 2)),
    });
  for (const m of bundle.media as {
    id: string;
    status: string;
    source_key: string;
    variants: Record<string, string>;
  }[]) {
    if (m.status !== 'READY') continue;
    entries.push({ path: 'media/' + m.id + '/source.png', objectKey: m.source_key });
    for (const [size, objectKey] of Object.entries(m.variants))
      entries.push({
        path: 'avatars/' + m.id + '/' + (/^\d+$/.test(size) ? size + '.webp' : size),
        objectKey,
      });
  }
  await putObject(key, JSON.stringify(bundle, null, 2), 'application/json');
  try {
    await uploadArchive(archiveKey, entries);
  } catch (error) {
    await deleteObject(key);
    throw error;
  }
  const published = await transaction(async (db) => {
    const active = (
      await query(
        "SELECT 1 FROM identities i JOIN memberships m ON m.identity_id=i.id JOIN accounts a ON a.id=m.account_id WHERE i.id=$1 AND i.state NOT IN ('DELETED','MERGED') AND m.account_id=$2 AND m.role='OWNER' AND a.state='ACTIVE' FOR UPDATE OF i",
        [identityId, e.account_id],
        db,
      )
    ).length;
    const ready =
      active &&
      (
        await query(
          "UPDATE exports SET status='READY',object_key=$2,archive_key=$3 WHERE id=$1 AND status='PENDING' AND expires_at>now() RETURNING id",
          [exportId, key, archiveKey],
          db,
        )
      ).length;
    if (ready)
      await event(db, identityId, e.account_id, 'export.completed', 'worker-export', { exportId });
    return ready;
  });
  if (!published) {
    await deleteObject(key);
    await deleteObject(archiveKey);
  }
}
