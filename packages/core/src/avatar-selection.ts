import { query, type DB } from './db.js';
export async function selectedAvatar(
  identityId: string,
  personaId: string | null,
  applicationId: string | null,
  domain: string | null,
  db?: DB,
): Promise<string | null> {
  const rows = await query<{ media_id: string }>(
    `SELECT s.media_id FROM avatar_selections s JOIN media m ON m.id=s.media_id AND m.identity_id=s.identity_id
 JOIN accounts a ON a.id=s.created_by AND a.state='ACTIVE'
 -- Memberships have no state column (001-foundation.sql). Current row existence plus active account and profile-capable role is the authorization boundary.
 JOIN memberships own ON own.identity_id=s.identity_id AND own.account_id=a.id AND own.role IN ('OWNER','ADMIN','EDITOR','PROFILE_MANAGER','BRAND_MANAGER')
 LEFT JOIN applications app ON app.id=s.application_id LEFT JOIN domains d ON d.id=s.domain_id
 WHERE s.identity_id=$1 AND s.persona_id IS NOT DISTINCT FROM $2::text AND s.revoked_at IS NULL AND s.starts_at<=now() AND (s.ends_at IS NULL OR s.ends_at>now()) AND m.status='READY' AND m.purpose='AVATAR'
 AND ((s.context='DEFAULT') OR (s.context='APPLICATION' AND s.application_id=$3 AND app.revoked_at IS NULL) OR (s.context='DOMAIN' AND d.domain=$4 AND d.revoked_at IS NULL AND d.verified_at IS NOT NULL AND d.last_checked_at>now()-interval '26 hours' AND d.expires_at>now()))
 ORDER BY CASE WHEN s.context='DEFAULT' THEN 0 ELSE 1 END DESC,s.starts_at DESC LIMIT 1`,
    [identityId, personaId, applicationId, domain],
    db,
  );
  return rows[0]?.media_id ?? null;
}
