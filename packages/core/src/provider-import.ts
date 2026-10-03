import type { PoolClient } from 'pg';
import { query } from './db.js';
import { id } from './security.js';
import { claimSchema, privatePolicy, type Policy } from '../../contracts/src/index.js';
import type { ProviderProfile } from './providers.js';
export type ProviderField = 'developer:github' | 'core:bio' | 'core:display_name';
export async function importProviderClaims(
  db: PoolClient,
  identityId: string,
  actorId: string,
  profile: ProviderProfile,
  fields: ProviderField[],
): Promise<void> {
  if (
    !(
      await query(
        "SELECT 1 FROM memberships WHERE identity_id=$1 AND account_id=$2 AND role='OWNER' FOR UPDATE",
        [identityId, actorId],
        db,
      )
    ).length
  )
    throw new Error('Provider owner unavailable');
  const [identity] = await query<{ revision: number }>(
    "SELECT * FROM identities WHERE id=$1 AND state='ACTIVE' FOR UPDATE",
    [identityId],
    db,
  );
  if (!identity) throw new Error('Identity unavailable');
  const claims = await query(
    'SELECT * FROM claims WHERE identity_id=$1 AND selected AND revoked_at IS NULL',
    [identityId],
    db,
  );
  await query(
    'INSERT INTO revisions(id,identity_id,actor_id,revision,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [id('rev'), identityId, actorId, identity.revision, JSON.stringify({ identity, claims })],
    db,
  );
  await query(
    'UPDATE identities SET revision=revision+1,updated_at=now() WHERE id=$1',
    [identityId],
    db,
  );
  const values = {
    'developer:github': profile.url,
    'core:bio': profile.bio,
    'core:display_name': profile.displayName,
  };
  for (const key of fields) {
    const value = values[key];
    if (value == null) continue;
    claimSchema.parse({ key, value, policy: privatePolicy });
    const existing = (
      await query<{ id: string; source: string; source_reference: string; policy: Policy }>(
        "SELECT id,source,source_reference,policy FROM claims WHERE identity_id=$1 AND key=$2 AND persona_id IS NULL AND locale='en' AND selected AND revoked_at IS NULL",
        [identityId, key],
        db,
      )
    )[0];
    const reference = 'github:' + profile.id,
      replace =
        !!existing &&
        existing.source === 'PROVIDER_SYNC' &&
        existing.source_reference === reference;
    if (replace) await query('UPDATE claims SET selected=false WHERE id=$1', [existing!.id], db);
    await query(
      "INSERT INTO claims(id,identity_id,key,value,policy,source,source_reference,verification_state,verification_method,verified_at,last_checked_at,source_updated_at,actor_id,selected,expires_at) VALUES($1,$2,$3,$4,$5,'PROVIDER_SYNC',$6,$7,$8,$9,now(),now(),$10,$11,$12)",
      [
        id('clm'),
        identityId,
        key,
        JSON.stringify(value),
        JSON.stringify(replace ? existing!.policy : privatePolicy),
        reference,
        key === 'developer:github' ? 'VERIFIED' : 'USER_ASSERTED',
        key === 'developer:github' ? 'OAUTH_ACCOUNT_PROOF' : null,
        key === 'developer:github' ? new Date() : null,
        actorId,
        !existing || replace,
        key === 'developer:github' ? new Date(Date.now() + 90 * 86400000) : null,
      ],
      db,
    );
  }
}
