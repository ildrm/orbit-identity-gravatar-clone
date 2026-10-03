import { DomainError } from '../../../packages/core/src/errors.js';
import { operationalMetrics } from '../../../packages/core/src/operational-metrics.js';
import { exportIdentity } from '../../../packages/core/src/export.js';
import { GitHubAdapter } from '../../../packages/core/src/providers.js';
import {
  importProviderClaims,
  type ProviderField,
} from '../../../packages/core/src/provider-import.js';
import express from 'express';
import { transformImage, imageVariant } from '../../../packages/core/src/media-edit.js';
import { revalidateWebProof, refreshFeed } from '../../../packages/core/src/web-proof.js';
import { revalidateDomain } from '../../../packages/core/src/domain-proof.js';
import { queueFederation, sendFederation } from '../../../packages/core/src/federation.js';
import sharp from 'sharp';
import nodemailer from 'nodemailer';
import { config } from '../../../packages/core/src/config.js';
import { query, transaction, closeDatabase } from '../../../packages/core/src/db.js';
import { id, secret, decrypt, webhookSignature } from '../../../packages/core/src/security.js';
import { enqueue, event } from '../../../packages/core/src/events.js';
import { putObject, getObject, deleteObject } from '../../../packages/core/src/storage.js';
import { safeHttps } from '../../../packages/core/src/outbound.js';
const c = config();
let stopped = false,
  lastTick = Date.now();
const smtp = nodemailer.createTransport({
  host: c.SMTP_HOST,
  port: c.SMTP_PORT,
  secure: c.SMTP_SECURE === 'true',
  ...(c.SMTP_USER ? { auth: { user: c.SMTP_USER, pass: c.SMTP_PASSWORD ?? '' } } : {}),
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
});
interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  lease_token: string;
  [key: string]: unknown;
}
async function email(payload: Record<string, unknown>, jobId: string) {
  if (payload.template === 'legacy-request') {
    const owner = (
      await query<{ email: string }>(
        "SELECT email FROM accounts WHERE id=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
        [payload.accountId],
      )
    )[0];
    if (!owner) return;
    await smtp.sendMail({
      from: c.EMAIL_FROM,
      to: owner.email,
      subject: 'A digital legacy request needs your attention',
      text:
        'Your nominated custodian requested an action under your digital legacy policy. No action can take place before the 30-day waiting period and two independent approvals. Sign in to review or veto it:\n' +
        c.PUBLIC_ORIGIN +
        '/dashboard\n\nRequest: ' +
        String(payload.legacyRequestId),
      messageId: '<' + jobId + '@' + new URL(c.PUBLIC_ORIGIN).hostname + '>',
    });
    return;
  }
  if (payload.template === 'notification') {
    const recipient = (
      await query<{ email: string }>(
        "SELECT a.email FROM accounts a JOIN notification_preferences p ON p.account_id=a.id WHERE a.id=$1 AND a.state='ACTIVE' AND p.email",
        [payload.accountId],
      )
    )[0];
    if (recipient)
      await smtp.sendMail({
        from: c.EMAIL_FROM,
        to: recipient.email,
        subject: 'Orbit account activity',
        text:
          'Account activity: ' +
          String(payload.kind).replaceAll('.', ' ').replaceAll('_', ' ') +
          '. Sign in to review: ' +
          c.PUBLIC_ORIGIN +
          '/dashboard',
        messageId: '<' + jobId + '@' + new URL(c.PUBLIC_ORIGIN).hostname + '>',
      });
    return;
  }
  const token =
      typeof payload.tokenEncrypted === 'string'
        ? decrypt(payload.tokenEncrypted)
        : String(payload.token),
    template = String(payload.template);
  if (template === 'change-email') {
    await smtp.sendMail({
      from: c.EMAIL_FROM,
      to: String(payload.to),
      subject: 'Confirm your new email address',
      text:
        'Sign in, open Account settings, and confirm this code:\n\n' +
        token +
        '\n\nThis code expires in 30 minutes.',
      messageId: '<' + jobId + '@' + new URL(c.PUBLIC_ORIGIN).hostname + '>',
    });
    return;
  }
  const path = template === 'verify' ? '/verify' : template === 'recovery' ? '/reset' : '/invite';
  const text =
    template === 'verify'
      ? 'Verify your email'
      : template === 'recovery'
        ? 'Reset your password'
        : 'Accept your identity invitation';
  await smtp.sendMail({
    from: c.EMAIL_FROM,
    to: String(payload.to),
    subject: text + ' · Identity',
    text:
      text +
      ':\n' +
      c.PUBLIC_ORIGIN +
      path +
      '?token=' +
      encodeURIComponent(token) +
      '\n\nIf you did not request this, you can ignore this email.',
    messageId: '<' + jobId + '@' + new URL(c.PUBLIC_ORIGIN).hostname + '>',
  });
}
async function media(payload: Record<string, unknown>) {
  const mediaId = String(payload.mediaId),
    identityId = String(payload.identityId);
  const [m] = await query<{
    source_key: string;
    status: string;
    bytes: number;
    purpose: string;
    transforms: unknown;
  }>('SELECT * FROM media WHERE id=$1 AND identity_id=$2', [mediaId, identityId]);
  if (!m || m.status !== 'PROCESSING') return;
  let input: Buffer;
  try {
    input = await getObject(m.source_key, 20 * 1024 * 1024);
    if (input.length !== m.bytes) throw new Error('SizeMismatch');
    const metadata = await sharp(input, {
      limitInputPixels: 40_000_000,
      failOn: 'warning',
    }).metadata();
    if (
      !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format ?? '') ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 12000 ||
      metadata.height > 12000 ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error('InvalidImage');
    const normalized = await transformImage(input, m.transforms);
    const variants: Record<string, string> = {};
    for (const size of [64, 128, 256, 512, 1024]) {
      for (const format of ['webp', 'jpeg', 'png', 'avif'] as const) {
        const output = await imageVariant(normalized, size, m.purpose, m.transforms, format),
          key = 'variants/' + identityId + '/' + mediaId + '/' + size + '.' + format;
        await putObject(key, output, 'image/' + format);
        variants[format === 'webp' ? String(size) : size + '.' + format] = key;
      }
    }
    const normalizedMetadata = await sharp(normalized).metadata();
    const safeSource = 'validated/' + identityId + '/' + mediaId + '.png';
    await putObject(safeSource, normalized, 'image/png');
    const published = await transaction(async (db) => {
      const updated = await query(
        "UPDATE media SET status='READY',mime='image/png',source_key=$1,bytes=$2,width=$3,height=$4,variants=$5 WHERE id=$6 AND status='PROCESSING' RETURNING id",
        [
          safeSource,
          normalized.length,
          normalizedMetadata.width,
          normalizedMetadata.height,
          JSON.stringify(variants),
          mediaId,
        ],
        db,
      );
      if (updated.length)
        await event(
          db,
          identityId,
          String(payload.actorId),
          'media.processed',
          String(payload.requestId),
          { mediaId },
        );
      return updated.length > 0;
    });
    if (!published)
      for (const key of [safeSource, ...Object.values(variants)]) await deleteObject(key);
    await deleteObject(m.source_key);
  } catch (error) {
    if (
      (error instanceof Error &&
        ['SizeMismatch', 'InvalidImage', 'Storage object exceeds limit'].includes(error.message)) ||
      (error instanceof Error && /Input|corrupt|unsupported|pixel|image|Image/i.test(error.message))
    ) {
      await query("UPDATE media SET status='REJECTED' WHERE id=$1 AND status='PROCESSING'", [
        mediaId,
      ]);
      await deleteObject(m.source_key);
      return;
    }
    throw error;
  }
}
async function dispatchEvent(payload: Record<string, unknown>) {
  const hooks = await query<{ id: string }>(
    `SELECT DISTINCT w.id FROM webhooks w JOIN applications a ON a.id=w.application_id JOIN consents c ON c.application_id=w.application_id WHERE w.enabled AND a.revoked_at IS NULL AND c.identity_id=$1 AND c.revoked_at IS NULL AND c.expires_at>now() AND w.events @> $2::jsonb`,
    [payload.identityId, JSON.stringify([payload.type])],
  );
  await transaction(async (db) => {
    await queueFederation(payload, db);
    for (const h of hooks)
      await enqueue(db, 'webhook', { webhookId: h.id, event: payload, deliveryId: id('dlv') });
  });
}
async function webhook(payload: Record<string, unknown>) {
  const [h] = await query<{
    url: string;
    secret_encrypted: string;
    enabled: boolean;
    application_id: string;
  }>('SELECT * FROM webhooks WHERE id=$1', [payload.webhookId]);
  if (
    !h ||
    !h.enabled ||
    !(
      await query('SELECT 1 FROM applications WHERE id=$1 AND revoked_at IS NULL', [
        h.application_id,
      ])
    ).length
  )
    return;
  const e = payload.event as Record<string, unknown>;
  if (
    !payload.test &&
    !(
      await query(
        `SELECT 1 FROM consents c JOIN applications a ON a.id=c.application_id JOIN accounts owner ON owner.id=c.account_id AND owner.state='ACTIVE' JOIN memberships m ON m.identity_id=c.identity_id AND m.account_id=c.account_id AND m.role='OWNER' WHERE c.application_id=$1 AND c.identity_id=$2 AND c.revoked_at IS NULL AND c.expires_at>now() AND a.revoked_at IS NULL AND c.scopes @> '["identity.read"]'::jsonb LIMIT 1`,
        [h.application_id, e.identityId],
      )
    ).length
  )
    return;
  const timestamp = String(Math.floor(Date.now() / 1000)),
    body = JSON.stringify({
      id: e.id,
      type: e.type,
      identityId: e.identityId,
      occurredAt: e.occurredAt,
    });
  const result = await safeHttps(h.url, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Identity-Timestamp': timestamp,
      'X-Identity-Delivery': String(payload.deliveryId),
      'X-Identity-Signature': webhookSignature(decrypt(h.secret_encrypted), timestamp, body),
    },
    maxBytes: 16384,
  });
  if (result.status < 200 || result.status >= 300) {
    await query('UPDATE webhooks SET failures=failures+1,enabled=(failures<9) WHERE id=$1', [
      payload.webhookId,
    ]);
    throw new Error('WebhookRejected');
  }
  await query('UPDATE webhooks SET failures=0 WHERE id=$1', [payload.webhookId]);
}
async function deleteMedia(payload: Record<string, unknown>) {
  const rows = await query<{ id: string; source_key: string; variants: Record<string, string> }>(
    "SELECT id,source_key,variants FROM media WHERE identity_id=$1 AND status='DELETED'",
    [payload.identityId],
  );
  for (const m of rows) {
    for (const key of [m.source_key, ...Object.values(m.variants)]) await deleteObject(key);
  }
  const exports = await query<{ object_key: string | null; archive_key: string | null }>(
    'SELECT object_key,archive_key FROM exports WHERE identity_id=$1',
    [payload.identityId],
  );
  for (const e of exports) {
    if (e.object_key) await deleteObject(e.object_key);
    if (e.archive_key) await deleteObject(e.archive_key);
  }
  await query(
    "UPDATE exports SET status='CANCELLED',object_key=NULL,archive_key=NULL WHERE identity_id=$1",
    [payload.identityId],
  );
}
async function syncProvider(payload: Record<string, unknown>) {
  const [connection] = await query<{
    id: string;
    identity_id: string;
    actor_id: string;
    token_encrypted: string;
    fields: ProviderField[];
    provider_id: string;
  }>(
    "SELECT p.* FROM provider_connections p JOIN memberships m ON m.identity_id=p.identity_id AND m.account_id=p.actor_id AND m.role='OWNER' JOIN identities i ON i.id=p.identity_id WHERE p.id=$1 AND p.revoked_at IS NULL AND i.state='ACTIVE'",
    [payload.connectionId],
  );
  if (!connection) return;
  const profile = await new GitHubAdapter().profile(decrypt(connection.token_encrypted));
  if (profile.id !== connection.provider_id) throw new Error('ProviderAccountChanged');
  await transaction(async (db) => {
    await importProviderClaims(
      db,
      connection.identity_id,
      connection.actor_id,
      profile,
      connection.fields,
    );
    await query(
      'UPDATE provider_connections SET last_synced_at=now(),last_error=NULL WHERE id=$1',
      [connection.id],
      db,
    );
    await event(
      db,
      connection.identity_id,
      connection.actor_id,
      'provider.synchronized',
      String(payload.requestId),
      { provider: 'github', source: 'scheduled' },
    );
  });
}
async function relay(payload: Record<string, unknown>, jobId: string) {
  const [allowed] = await query(
    "SELECT 1 FROM identities i WHERE i.id=$1 AND i.state='ACTIVE' AND i.visibility<>'PRIVATE' AND i.contact_enabled AND NOT EXISTS(SELECT 1 FROM contact_blocks b JOIN contact_messages m ON m.sender_id=b.account_id WHERE b.identity_id=i.id AND m.id=$2)",
    [payload.identityId, payload.messageId],
  );
  if (!allowed) return;
  await smtp.sendMail({
    from: c.EMAIL_FROM,
    to: String(payload.to),
    replyTo: String(payload.replyTo),
    subject: 'Orbit contact: ' + String(payload.subject),
    text:
      String(payload.body) +
      '\n\nSent through Orbit. Block this sender from your identity workspace if needed.',
    messageId: '<' + jobId + '@' + new URL(c.PUBLIC_ORIGIN).hostname + '>',
  });
  await query("UPDATE contact_messages SET state='SENT' WHERE id=$1", [payload.messageId]);
}
async function processJob(job: Job) {
  switch (job.kind) {
    case 'delete-objects':
      for (const key of job.payload.keys as string[]) await deleteObject(key);
      return;
    case 'relay':
      return relay(job.payload, job.id);
    case 'provider-sync':
      return syncProvider(job.payload);
    case 'email':
      return email(job.payload, job.id);
    case 'media':
      return media(job.payload);
    case 'web-proof':
      return revalidateWebProof(job.payload);
    case 'feed-refresh':
      return refreshFeed(job.payload);
    case 'domain-revalidate':
      return revalidateDomain(job.payload);
    case 'federation':
      return sendFederation(job.payload);
    case 'event':
      return dispatchEvent(job.payload);
    case 'webhook':
      return webhook(job.payload);
    case 'export':
      return exportIdentity(job.payload);
    case 'delete-media':
      return deleteMedia(job.payload);
    default:
      throw new Error('UnknownJobKind');
  }
}
const app = express();
operationalMetrics(app, 'worker', () => lastTick, true);
app.get('/health', (_req, res) =>
  res
    .status(Date.now() - lastTick < 120000 ? 200 : 503)
    .json({ status: stopped ? 'stopping' : 'running' }),
);
const server = app.listen(4010, '0.0.0.0');
async function loop() {
  while (!stopped) {
    lastTick = Date.now();
    let job: Job | undefined;
    try {
      job = await transaction(async (db) => {
        const token = secret();
        const [j] = await query<Job>(
          `WITH selected AS (SELECT id FROM jobs WHERE (status='PENDING' AND run_after<=now()) OR (status='RUNNING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='RUNNING',lease_until=now()+interval '90 seconds',lease_token=$1,attempts=attempts+1 FROM selected WHERE jobs.id=selected.id RETURNING jobs.*`,
          [token],
          db,
        );
        return j;
      });
      if (job) {
        const heartbeat = setInterval(() => {
          void query(
            "UPDATE jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2",
            [job!.id, job!.lease_token],
          ).catch(() => process.stderr.write('{"level":"error","code":"LEASE_RENEWAL_FAILED"}\n'));
        }, 30000);
        try {
          await processJob(job);
          await query(
            "UPDATE jobs SET status='COMPLETED',completed_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
            [job.id, job.lease_token],
          );
        } finally {
          clearInterval(heartbeat);
        }
      }
    } catch (error) {
      const candidate =
        error instanceof DomainError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'UnknownError';
      const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(candidate) ? candidate : 'UnknownError';
      process.stderr.write(
        JSON.stringify({
          level: 'error',
          code: 'JOB_FAILED',
          jobId: job?.id,
          kind: job?.kind,
          name,
        }) + '\n',
      );
      if (job) {
        if (job.kind === 'provider-sync')
          await query(
            'UPDATE provider_connections SET last_error=$2 WHERE id=$1 AND revoked_at IS NULL',
            [job.payload.connectionId, name],
          ).catch(() =>
            process.stderr.write('{"level":"error","code":"PROVIDER_ERROR_PERSIST_FAILED"}\n'),
          );
        if (job.attempts >= 5) {
          if (job.kind === 'media')
            await query("UPDATE media SET status='REJECTED' WHERE id=$1 AND status='PROCESSING'", [
              job.payload.mediaId,
            ]);
          if (job.kind === 'export')
            await query("UPDATE exports SET status='FAILED' WHERE id=$1 AND status='PENDING'", [
              job.payload.exportId,
            ]);
        }
        await query(
          "UPDATE jobs SET status=$1,run_after=now()+($2 * interval '1 second'),lease_until=NULL,last_error=$3 WHERE id=$4 AND lease_token=$5",
          [
            job.attempts >= 5 ? 'DEAD' : 'PENDING',
            Math.min(3600, 2 ** job.attempts * 5),
            name,
            job.id,
            job.lease_token,
          ],
        ).catch(() =>
          process.stderr.write('{"level":"error","code":"JOB_RETRY_PERSIST_FAILED"}\n'),
        );
      }
    }
    if (!job) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.close();
  await closeDatabase();
}
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});
await loop();
