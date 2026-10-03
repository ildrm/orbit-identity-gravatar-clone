import { query, type DB } from './db.js';
import { id, encrypt } from './security.js';
const notificationKinds = new Set([
  'session.created',
  'account.password_reset',
  'account.password_changed',
  'account.email_changed',
  'account.totp_enabled',
  'account.totp_disabled',
  'account.backup_codes_rotated',
  'passkey.created',
  'passkey.removed',
  'domain.failed',
  'domain.revoked',
  'domain.verified',
  'provider.failed',
  'credential.issued',
  'consent.granted',
  'oauth.consent_granted',
  'export.completed',
  'identity.transferred',
  'identity.lifecycle_changed',
  'moderation.disposition',
  'legacy.requested',
  'legacy.applied',
]);
async function notify(db: DB, accountId: string, identity: string | null, kind: string) {
  const recipient = (
    await query<{ email: string; in_app: boolean; email_enabled: boolean }>(
      "SELECT a.email,COALESCE(p.in_app,true) AS in_app,COALESCE(p.email,false) AS email_enabled FROM accounts a LEFT JOIN notification_preferences p ON p.account_id=a.id WHERE a.id=$1 AND a.state='ACTIVE' AND a.verified_at IS NOT NULL",
      [accountId],
      db,
    )
  )[0];
  if (!recipient || (!recipient.in_app && !recipient.email_enabled)) return;
  const previous = (
    await query(
      "SELECT 1 FROM notifications WHERE account_id=$1 AND kind=$2 AND created_at>now()-interval '1 hour' LIMIT 1",
      [accountId, kind],
      db,
    )
  ).length;
  await query(
    'INSERT INTO notifications(id,account_id,identity_id,kind) VALUES($1,$2,$3,$4)',
    [id('ntf'), accountId, identity, kind],
    db,
  );
  if (recipient.email_enabled && !previous)
    await enqueue(db, 'email', { template: 'notification', to: recipient.email, accountId, kind });
}
export async function audit(
  db: DB,
  actor: string | null,
  identity: string | null,
  action: string,
  requestId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await query(
    'INSERT INTO audit(id,actor_id,identity_id,action,request_id,data) VALUES($1,$2,$3,$4,$5,$6)',
    [id('aud'), actor, identity, action, requestId, JSON.stringify(data)],
    db,
  );
  if (actor && notificationKinds.has(action)) await notify(db, actor, identity, action);
}
export async function enqueue(
  db: DB,
  kind: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const jobId = id('job');
  if (kind === 'email' && typeof payload.token === 'string') {
    const { token, ...rest } = payload;
    payload = { ...rest, tokenEncrypted: encrypt(token) };
  }
  await query(
    'INSERT INTO jobs(id,kind,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [jobId, kind, JSON.stringify(payload)],
    db,
  );
  return jobId;
}
export async function event(
  db: DB,
  identity: string,
  actor: string,
  action: string,
  requestId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await audit(db, actor, identity, action, requestId, data);
  if (notificationKinds.has(action))
    for (const owner of await query<{ account_id: string }>(
      "SELECT account_id FROM memberships WHERE identity_id=$1 AND role='OWNER' AND account_id<>$2",
      [identity, actor],
      db,
    ))
      await notify(db, owner.account_id, identity, action);
  await enqueue(db, 'event', {
    id: id('evt'),
    type: action,
    identityId: identity,
    data,
    occurredAt: new Date().toISOString(),
  });
}
