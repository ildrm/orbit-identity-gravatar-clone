import { query, transaction } from './db.js';
import { safeHttps } from './outbound.js';
import { config } from './config.js';
import { reciprocalLink } from './web-content.js';
import { event } from './events.js';
export async function revalidateWebProof(payload: Record<string, unknown>) {
  const [p] = await query<{
    id: string;
    identity_id: string;
    url: string;
    handle: string;
    actor_id: string;
  }>(
    "SELECT w.*,i.handle,m.account_id AS actor_id FROM web_proofs w JOIN identities i ON i.id=w.identity_id JOIN memberships m ON m.identity_id=i.id AND m.role='OWNER' WHERE w.id=$1 AND w.revoked_at IS NULL AND i.state='ACTIVE' AND i.visibility IN ('PUBLIC','UNLISTED')",
    [payload.proofId],
  );
  if (!p) return;
  let valid = false;
  try {
    const local = (
      await query(
        "SELECT 1 FROM claims WHERE identity_id=$1 AND selected AND revoked_at IS NULL AND policy->>'visibility' IN ('PUBLIC','UNLISTED') AND policy->>'transformation'='FULL' AND ((key='core:website' AND value #>> '{}'=$2) OR (key='core:links' AND EXISTS(SELECT 1 FROM jsonb_array_elements(value) e WHERE e->>'url'=$2)))",
        [p.identity_id, p.url],
      )
    ).length;
    if (local) {
      const remote = await safeHttps(p.url, { maxBytes: 256000, headers: { Accept: 'text/html' } });
      valid =
        remote.status === 200 &&
        reciprocalLink(remote.body, p.url, config().PUBLIC_ORIGIN + '/u/' + p.handle);
    }
  } catch {
    valid = false;
  }
  await transaction(async (db) => {
    const row = (
      await query(
        'SELECT 1 FROM web_proofs WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',
        [p.id],
        db,
      )
    )[0];
    if (!row) return;
    await query(
      "UPDATE web_proofs SET status=$2,last_checked_at=now(),verified_at=CASE WHEN $2='VERIFIED' THEN now() ELSE verified_at END,expires_at=CASE WHEN $2='VERIFIED' THEN now()+interval '7 days' ELSE now() END WHERE id=$1",
      [p.id, valid ? 'VERIFIED' : 'FAILED'],
      db,
    );
    await event(
      db,
      p.identity_id,
      p.actor_id,
      valid ? 'web.verified' : 'web.failed',
      String(payload.requestId ?? 'scheduler'),
      { proofId: p.id },
    );
  });
}
export async function refreshFeed(payload: Record<string, unknown>) {
  const [block] = await query<{
    id: string;
    identity_id: string;
    configuration: { url?: string };
    actor_id: string;
  }>(
    "SELECT b.*,m.account_id AS actor_id FROM profile_blocks b JOIN memberships m ON m.identity_id=b.identity_id AND m.role='OWNER' JOIN identities i ON i.id=b.identity_id WHERE b.id=$1 AND b.kind='feed' AND i.state='ACTIVE'",
    [payload.blockId],
  );
  if (!block?.configuration.url) return;
  const response = await safeHttps(block.configuration.url, {
    maxBytes: 256000,
    headers: { Accept: 'application/rss+xml, application/atom+xml' },
  });
  if (response.status !== 200) throw new Error('FeedUnavailable');
  const { feedItems } = await import('./web-content.js'),
    items = feedItems(response.body);
  await transaction(async (db) => {
    const current = (
      await query<{ configuration: { url?: string } }>(
        'SELECT configuration FROM profile_blocks WHERE id=$1 FOR UPDATE',
        [block.id],
        db,
      )
    )[0];
    if (current?.configuration.url !== block.configuration.url) return;
    await query(
      "UPDATE profile_blocks SET configuration=jsonb_set(configuration,'{items}',$2::jsonb),updated_at=now() WHERE id=$1",
      [block.id, JSON.stringify(items)],
      db,
    );
    await event(
      db,
      block.identity_id,
      block.actor_id,
      'profile.updated',
      String(payload.requestId ?? 'scheduler'),
      { blockId: block.id, feedRefreshed: true },
    );
  });
}
