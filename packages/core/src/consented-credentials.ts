import { query } from './db.js';
import { decrypt } from './security.js';
export async function credentialsForGrant(consentId: string) {
  const rows = await query<{ id: string; token_encrypted: string }>(
    "SELECT c.id,c.token_encrypted FROM consents g JOIN identities holder ON holder.id=g.identity_id AND holder.state='ACTIVE' JOIN accounts owner ON owner.id=g.account_id AND owner.state='ACTIVE' JOIN memberships m ON m.identity_id=g.identity_id AND m.account_id=g.account_id AND m.role='OWNER' JOIN applications app ON app.id=g.application_id AND app.revoked_at IS NULL JOIN credentials c ON c.subject_id=g.identity_id AND g.fields @> jsonb_build_array('credential:'||c.id) JOIN enterprise_assertions a ON a.id=c.assertion_id JOIN signing_keys k ON k.id=c.key_id JOIN identities issuer ON issuer.id=c.issuer_id WHERE g.id=$1 AND g.revoked_at IS NULL AND g.expires_at>now() AND g.persona_id IS NULL AND g.scopes @> '[\"credentials.read\"]'::jsonb AND c.revoked_at IS NULL AND c.expires_at>now() AND c.token_encrypted<>'' AND a.state='ACCEPTED' AND a.revoked_at IS NULL AND a.expires_at>now() AND k.state<>'REVOKED' AND issuer.state='ACTIVE'",
    [consentId],
  );
  return { credentials: rows.map((c) => ({ id: c.id, credential: decrypt(c.token_encrypted) })) };
}
