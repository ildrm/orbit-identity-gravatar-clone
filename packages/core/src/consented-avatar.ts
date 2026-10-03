import { z } from 'zod';
import sharp from 'sharp';
import { query } from './db.js';
import { digest } from './security.js';
import { DomainError } from './errors.js';
import { getObject } from './storage.js';
import { selectedAvatar } from './avatar-selection.js';
import { generatedAvatar, type AvatarStyle } from './avatar.js';
import { applicationAccess } from './application-access.js';

interface Grant {
  id: string;
  identity_id: string;
  application_id: string;
  persona_id: string | null;
  avatar_media_id: string | null;
  persona_avatar: string | null;
  avatar_style: AvatarStyle;
  avatar_color: string;
}
async function grantFor(token: string, oauth: boolean): Promise<Grant> {
  const credential = oauth
    ? 'JOIN oauth_tokens t ON t.consent_id=c.id AND t.digest=$1 AND t.kind=\'ACCESS\' AND t.expires_at>now() AND t.revoked_at IS NULL AND t.scopes @> \'["identity.read","avatar.read"]\'::jsonb'
    : '';
  const [grant] = await query<Grant>(
    `SELECT c.id,c.identity_id,c.application_id,c.persona_id,i.avatar_media_id,p.avatar_media_id AS persona_avatar,i.avatar_style,i.avatar_color
     FROM consents c ${credential}
     JOIN applications a ON a.id=c.application_id AND a.revoked_at IS NULL
     JOIN identities i ON i.id=c.identity_id AND i.state='ACTIVE'
     JOIN accounts holder ON holder.id=c.account_id AND holder.state='ACTIVE'
     JOIN memberships owner ON owner.identity_id=c.identity_id AND owner.account_id=c.account_id AND owner.role='OWNER'
     LEFT JOIN personas p ON p.id=c.persona_id AND p.identity_id=c.identity_id
     WHERE c.protocol=$2 AND c.revoked_at IS NULL AND c.expires_at>now()
     AND c.scopes @> '["identity.read","avatar.read"]'::jsonb
     AND (c.persona_id IS NULL OR p.active)
     ${oauth ? '' : 'AND c.token_digest=$1'}`,
    [digest(token), oauth ? 'OAUTH' : 'NATIVE'],
  );
  if (!grant)
    throw new DomainError(
      'INVALID_TOKEN',
      'Current holder-owned avatar.read consent is required.',
      401,
    );
  return grant;
}
export async function consentedAvatar(
  token: string,
  oauth: boolean,
  input: unknown,
  requestId: string,
) {
  const options = z
    .object({
      size: z.coerce.number().int().min(16).max(1024).default(128),
      format: z.enum(['webp', 'jpeg', 'png', 'avif']).default('webp'),
    })
    .strict()
    .parse(input);
  const grant = await grantFor(token, oauth);
  const mediaId =
    (await selectedAvatar(grant.identity_id, grant.persona_id, grant.application_id, null)) ??
    grant.persona_avatar ??
    grant.avatar_media_id;
  const media = mediaId
    ? (
        await query<{ variants: Record<string, string> }>(
          "SELECT variants FROM media WHERE id=$1 AND identity_id=$2 AND status='READY' AND purpose='AVATAR' AND (persona_id IS NULL OR persona_id=$3)",
          [mediaId, grant.identity_id, grant.persona_id],
        )
      )[0]
    : undefined;
  const width = [64, 128, 256, 512, 1024].find((value) => value >= options.size) ?? 1024;
  const key =
    media?.variants[options.format === 'webp' ? String(width) : width + '.' + options.format];
  const bytes = key
    ? await getObject(key)
    : await sharp(
        Buffer.from(
          generatedAvatar(grant.identity_id, options.size, grant.avatar_style, grant.avatar_color),
        ),
      )
        .toFormat(options.format)
        .toBuffer();
  // Recheck after the object read; a revoke during processing must not complete a new disclosure.
  await grantFor(token, oauth);
  await applicationAccess(grant.id, 'avatar', requestId);
  await query('UPDATE consents SET last_access_at=now() WHERE id=$1', [grant.id]);
  return { bytes, contentType: 'image/' + options.format };
}
