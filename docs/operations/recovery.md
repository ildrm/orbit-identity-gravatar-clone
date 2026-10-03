# Backup, restore and incident runbook

## Consistent encrypted database and object backup

Use a separate 64-hex BACKUP_ENCRYPTION_KEY from the operator secret store. Keep it separately from the archive and the application key ring; do not reuse ENCRYPTION_KEY. Stop all API, worker, scheduler and external administrative writers during capture. Keep the database, Redis and object storage running.

```sh
docker compose stop api worker scheduler
node --env-file=.env scripts/full-backup.mjs create --maintenance
docker compose up -d --no-build api worker scheduler
```

Capture includes a custom PostgreSQL dump and every object in the private S3 bucket. Version 2 is gzip-compressed bounded NDJSON inside an AES-256-GCM envelope, with chunking and per-file SHA-256/length checks. The maximum envelope/object limit is 100 GiB. The command requires explicit maintenance mode; it cannot detect writers on another host, so the operator must stop them too. Failed captures do not become accepted backups. Archives and temporary material stay outside Git.

Preserve the encrypted archive, its independent key, the application key ring, S3 credentials, release manifest and environment configuration in separate protected stores. Schedule maintenance capture or a provider-consistent snapshot offsite according to the deployment's recovery objectives. This repository does not configure a particular offsite service or PostgreSQL WAL/PITR provider.

## Restore to isolated targets

Choose a fresh database and bucket with the required prefixes and a unique hexadecimal suffix. The command refuses the primary database/bucket and existing targets.

```sh
node --env-file=.env scripts/full-backup.mjs restore backups/ARCHIVE.enc restore_a1b2c3d4e5f60718 orbit-restore-a1b2c3d4e5f60718
```

Use the actual archive filename returned by capture. Restore authenticates the complete envelope and validates every file before creating targets or writing objects. A tampered archive must fail with no target mutation. Restore returns isolated-target metadata. Preserve the affected original volumes for investigation.

Check migration history, row/object counts, hashes and known public/private canaries. Start a staging stack pointing to the restored database and bucket, with the retained key ring and isolated outbound integration configuration. Verify readiness, owner login, public/private projection, current grants and media. Reconcile deletions/revocations that occurred after capture before deliberately switching traffic. Refresh Redis delivery generations during maintenance; never reuse an old restored cache.

The actual rehearsal verifies all current migrations, a random 1 MiB private object, authenticated restore, absence of plaintext markers, tamper rejection and refusal to overwrite primary storage:

```sh
node --env-file=.env scripts/full-backup-test.mjs
```

The older backup.mjs and PostgreSQL-only restore checks are diagnostic utilities. They do not provide full media recovery. Streaming decryption in that legacy tool can emit bytes before final authentication; use the full-backup workflow for incident restores.

## Dependency and job recovery

API /health/live indicates liveness; /health/ready checks PostgreSQL and Redis. Database queries have server and client deadlines, so a paused or unreachable database removes readiness. Redis failure denies requests instead of bypassing quotas. S3 requests have explicit connection, request and socket deadlines with bounded SDK retries. SMTP has bounded connection/socket timeouts. Outbound HTTPS validates every resolved address, pins DNS, follows no redirects, and enforces lookup, socket, total response and byte limits.

Worker jobs persist in PostgreSQL. A killed worker's 90-second lease expires and another worker can reclaim it; at-least-once webhook delivery requires receiver deduplication. Current consent is rechecked before send. Scheduler restart uses deterministic hourly IDs. Provider transport has a 30/minute token-bound limit, one bounded GET retry, an encrypted 120-second cache, and a 30-second circuit after three failed calls.

Inspect metadata, never sensitive job payloads:

```sql
SELECT kind,status,count(*),min(created_at) FROM jobs GROUP BY kind,status;
SELECT id,kind,attempts,last_error,run_after FROM jobs WHERE status='DEAD' ORDER BY created_at;
```

Fix the dependency/input before replay. Application owners can inspect deliveries and replay completed/dead webhook jobs through Developer controls; replay retains the original ID and rechecks current authorization. For other jobs, an operator must verify current state and side-effect idempotency, then perform a narrowly scoped audited maintenance action.

## Delivery fence reconciliation

A crashed sensitive writer can leave the persistent Redis writer counter above zero. Delivery then uses authoritative SQL; it does not serve stale policy. Stop every writer and migration process, ensure all PostgreSQL transactions have finished, run the maintenance reset, then restart writers. Never reset the counter while writers are active.

```sh
node --env-file=.env scripts/reset-delivery-cache.mjs --maintenance
```

This rotates the generation and resets the fence, making old entries unreachable. It also applies after operator SQL edits or a restored database. Ordinary API and scheduler writes fence automatically.

## Security incident

Restrict affected identities, revoke sessions/grants/provider connections, disable webhooks and rotate compromised secrets. Keep minimal actor/request evidence without putting private fields into tickets. Follow the key-rotation and retention policies. Recovery and deletion must be verified before reopening traffic.
