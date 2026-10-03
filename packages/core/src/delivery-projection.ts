import { query } from './db.js';
import { selectedAvatar } from './avatar-selection.js';
import { deliveryProjection } from './delivery-cache.js';
import type { AvatarStyle } from './avatar.js';
export interface DeliveryIdentity {
  id: string;
  avatar_media_id: string | null;
  visibility: string;
  state: string;
  avatar_style: AvatarStyle;
  avatar_color: string;
  analytics_enabled: boolean;
}
async function deadline(identityId: string): Promise<number> {
  const [r] = await query<{ deadline: Date | null }>(
    `SELECT min(t) AS deadline FROM (
 SELECT starts_at AS t FROM avatar_selections WHERE identity_id=$1 AND revoked_at IS NULL AND starts_at>now()
 UNION ALL SELECT ends_at FROM avatar_selections WHERE identity_id=$1 AND revoked_at IS NULL AND ends_at>now()
 UNION ALL SELECT expires_at FROM domains WHERE identity_id=$1 AND revoked_at IS NULL AND expires_at>now()
 UNION ALL SELECT last_checked_at+interval '26 hours' FROM domains WHERE identity_id=$1 AND revoked_at IS NULL AND last_checked_at+interval '26 hours'>now()
 ) boundaries`,
    [identityId],
  );
  return Math.min(Date.now() + 15_000, r?.deadline?.getTime() ?? Infinity);
}
export function avatarProjection(
  identifier: string,
  persona: string | null,
  application: string | null,
  domain: string | null,
) {
  return deliveryProjection(
    'avatar:' + JSON.stringify([identifier, persona, application, domain]),
    async () => {
      const [identity] = await query<DeliveryIdentity>(
        'SELECT DISTINCT i.id,i.avatar_media_id,i.visibility,i.state,i.avatar_style,i.avatar_color,i.analytics_enabled FROM identities i LEFT JOIN handles h ON h.identity_id=i.id WHERE i.id=$1 OR h.handle=$1',
        [identifier.replace(/^@/, '')],
      );
      const published =
        !!identity &&
        identity.visibility !== 'PRIVATE' &&
        ['ACTIVE', 'MEMORIALIZED', 'FROZEN'].includes(identity.state);
      let mediaId = published ? identity.avatar_media_id : null,
        personaId: string | null = null,
        variants: Record<string, string> = {};
      if (published && persona) {
        const [p] = await query<{ id: string; avatar_media_id: string | null }>(
          'SELECT id,avatar_media_id FROM personas WHERE identity_id=$1 AND slug=$2 AND active',
          [identity.id, persona],
        );
        mediaId = p?.avatar_media_id ?? mediaId;
        personaId = p?.id ?? null;
      }
      if (published)
        mediaId = (await selectedAvatar(identity.id, personaId, application, domain)) ?? mediaId;
      if (published && mediaId) {
        const [m] = await query<{ variants: Record<string, string> }>(
          "SELECT variants FROM media WHERE id=$1 AND identity_id=$2 AND status='READY'",
          [mediaId, identity.id],
        );
        variants = m?.variants ?? {};
      }
      return {
        value: { identity: published ? identity : null, mediaId, variants },
        validUntil: identity ? await deadline(identity.id) : Date.now() + 15_000,
      };
    },
  );
}
export function assetProjection(mediaId: string) {
  return deliveryProjection('asset:' + mediaId, async () => {
    const [m] = await query<{ identity_id: string; variants: Record<string, string> }>(
      `SELECT m.identity_id,m.variants FROM media m JOIN identities i ON i.id=m.identity_id WHERE m.id=$1 AND m.status='READY' AND i.state IN ('ACTIVE','MEMORIALIZED','FROZEN') AND i.visibility<>'PRIVATE' AND (m.public_enabled OR i.avatar_media_id=m.id OR EXISTS(SELECT 1 FROM personas p WHERE p.identity_id=i.id AND p.active AND p.avatar_media_id=m.id) OR EXISTS(SELECT 1 FROM avatar_selections s JOIN accounts a ON a.id=s.created_by AND a.state='ACTIVE' JOIN memberships own ON own.identity_id=s.identity_id AND own.account_id=a.id AND own.role IN ('OWNER','ADMIN','EDITOR','PROFILE_MANAGER','BRAND_MANAGER') LEFT JOIN domains d ON d.id=s.domain_id LEFT JOIN applications app ON app.id=s.application_id WHERE s.identity_id=i.id AND s.media_id=m.id AND s.revoked_at IS NULL AND s.starts_at<=now() AND (s.ends_at IS NULL OR s.ends_at>now()) AND (s.persona_id IS NULL OR EXISTS(SELECT 1 FROM personas sp WHERE sp.id=s.persona_id AND sp.identity_id=i.id AND sp.active)) AND (s.context='DEFAULT' OR (s.context='APPLICATION' AND app.revoked_at IS NULL) OR (s.context='DOMAIN' AND d.revoked_at IS NULL AND d.verified_at IS NOT NULL AND d.last_checked_at>now()-interval '26 hours' AND d.expires_at>now()))))`,
      [mediaId],
    );
    return {
      value: m?.variants ?? {},
      validUntil: m ? await deadline(m.identity_id) : Date.now() + 15_000,
    };
  });
}
