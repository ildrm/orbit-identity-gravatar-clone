import { beginDeliveryWrite, endDeliveryWrite } from '../../../packages/core/src/delivery-cache.js';
import { closeRedis } from '../../../packages/core/src/redis.js';
import { operationalMetrics } from '../../../packages/core/src/operational-metrics.js';
import express from 'express';
import { enqueue } from '../../../packages/core/src/events.js';
import { database, closeDatabase } from '../../../packages/core/src/db.js';
let stopped = false,
  lastSuccess = 0;
async function tick() {
  const db = await database().connect();
  let fenced = false;
  try {
    await beginDeliveryWrite();
    fenced = true;
    await db.query('BEGIN');
    const result = await db.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(718205) AS locked',
    );
    if (!result.rows[0]?.locked) {
      await db.query('ROLLBACK');
      return;
    }
    await db.query(
      "UPDATE enterprise_assertions SET state='EXPIRED',updated_at=now() WHERE expires_at<=now() AND state IN ('PENDING','ACCEPTED')",
    );
    await db.query(
      "UPDATE claims SET verification_state='EXPIRED' WHERE expires_at<=now() AND verification_state IN ('VERIFIED','ISSUER_VERIFIED')",
    );
    await db.query(
      'UPDATE domains SET revoked_at=now() WHERE expires_at<=now() AND revoked_at IS NULL',
    );
    await db.query(
      'UPDATE consents SET revoked_at=now() WHERE expires_at<=now() AND revoked_at IS NULL',
    );
    await db.query("DELETE FROM oauth_requests WHERE expires_at<now()-interval '1 day'");
    await db.query("DELETE FROM oauth_codes WHERE expires_at<now()-interval '30 days'");
    await db.query("DELETE FROM oauth_tokens WHERE expires_at<now()-interval '30 days'");
    await db.query("DELETE FROM challenges WHERE expires_at<now()-interval '1 day'");
    await db.query(
      "DELETE FROM sessions WHERE expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days'",
    );
    await db.query(
      "DELETE FROM jobs WHERE status='COMPLETED' AND completed_at<now()-interval '7 days'",
    );
    await db.query(
      "UPDATE jobs SET payload='{}' WHERE kind IN ('email','relay') AND status='COMPLETED' AND completed_at<now()-interval '1 day'",
    );
    await db.query(
      "UPDATE reports SET description='Evidence removed after 90 days.' WHERE state<>'OPEN' AND created_at<now()-interval '90 days'",
    );
    await db.query(
      "UPDATE moderation_appeals SET reason='Evidence removed after 90 days.' WHERE state<>'OPEN' AND reviewed_at<now()-interval '90 days'",
    );
    await db.query("DELETE FROM application_access_logs WHERE created_at<now()-interval '30 days'");
    await db.query("DELETE FROM jobs WHERE status='DEAD' AND created_at<now()-interval '30 days'");
    await db.query("DELETE FROM audit WHERE created_at<now()-interval '1 year'");
    await db.query("DELETE FROM notifications WHERE created_at<now()-interval '90 days'");
    await db.query(
      "UPDATE legacy_requests SET evidence_encrypted='' WHERE state IN ('VETOED','REJECTED','APPLIED') AND created_at<now()-interval '30 days'",
    );
    const expired = await db.query<{ id: string; object_key: string; archive_key: string | null }>(
      "UPDATE exports SET status='EXPIRED' WHERE expires_at<=now() AND status='READY' RETURNING id,object_key,archive_key",
    );
    for (const e of expired.rows) {
      await enqueue(db, 'delete-objects', { keys: [e.object_key, e.archive_key].filter(Boolean) });
      await db.query('UPDATE exports SET object_key=NULL,archive_key=NULL WHERE id=$1', [e.id]);
    }
    const abandoned = await db.query<{ id: string; source_key: string }>(
      "UPDATE media SET status='REJECTED' WHERE status='PENDING' AND created_at<now()-interval '1 day' RETURNING id,source_key",
    );
    for (const m of abandoned.rows) await enqueue(db, 'delete-objects', { keys: [m.source_key] });
    await db.query("DELETE FROM contact_messages WHERE created_at<now()-interval '90 days'");
    await db.query("DELETE FROM revisions WHERE created_at<now()-interval '1 year'");
    await db.query("DELETE FROM federation_receipts WHERE received_at<now()-interval '1 day'");
    await db.query(
      "UPDATE remote_profiles SET profile=NULL,state='DELETED' WHERE expires_at<=now() AND state='ACTIVE'",
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(i.id||date_trunc('hour',now())::text),'event',jsonb_build_object('id','evt_'||md5(i.id||date_trunc('hour',now())::text),'identityId',i.id,'type','federation.refresh') FROM identities i WHERE federation_enabled AND state='ACTIVE' ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(d.id||date_trunc('hour',now())::text),'domain-revalidate',jsonb_build_object('domainId',d.id) FROM domains d WHERE d.verified_at IS NOT NULL AND d.revoked_at IS NULL AND (d.last_checked_at IS NULL OR d.last_checked_at<now()-interval '12 hours') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(w.id||date_trunc('hour',now())::text),'web-proof',jsonb_build_object('proofId',w.id) FROM web_proofs w WHERE w.status='VERIFIED' AND w.revoked_at IS NULL AND w.last_checked_at<now()-interval '1 day' ON CONFLICT DO NOTHING",
    );
    await db.query(
      "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(b.id||date_trunc('hour',now())::text),'feed-refresh',jsonb_build_object('blockId',b.id) FROM profile_blocks b WHERE b.kind='feed' AND b.enabled AND b.configuration ? 'url' AND b.updated_at<now()-interval '1 hour' ON CONFLICT DO NOTHING",
    );
    await db.query('DELETE FROM analytics_daily WHERE day<current_date-90');
    await db.query(
      "INSERT INTO jobs(id,kind,payload) SELECT 'job_'||md5(id||date_trunc('hour',now())::text),'provider-sync',jsonb_build_object('connectionId',id,'requestId',md5(id||date_trunc('hour',now())::text)) FROM provider_connections WHERE mode='SYNC' AND revoked_at IS NULL AND actor_id IS NOT NULL AND (last_synced_at IS NULL OR last_synced_at<now()-interval '1 hour') ON CONFLICT DO NOTHING",
    );
    await db.query('COMMIT');
    lastSuccess = Date.now();
  } catch (error) {
    await db.query('ROLLBACK');
    process.stderr.write(
      JSON.stringify({
        level: 'error',
        code: 'SCHEDULER_FAILED',
        name: error instanceof Error ? error.name : 'UnknownError',
      }) + '\n',
    );
  } finally {
    try {
      if (fenced) await endDeliveryWrite();
    } finally {
      db.release();
    }
  }
}
const app = express();
operationalMetrics(app, 'scheduler', () => lastSuccess);
app.get('/health', (_req, res) =>
  res.status(Date.now() - lastSuccess < 120000 ? 200 : 503).json({ status: 'scheduled' }),
);
const server = app.listen(4011, '0.0.0.0');
await tick();
const timer = setInterval(() => {
  if (!stopped) void tick();
}, 60000);
async function shutdown() {
  stopped = true;
  clearInterval(timer);
  server.close();
  await Promise.all([closeDatabase(), closeRedis()]);
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
