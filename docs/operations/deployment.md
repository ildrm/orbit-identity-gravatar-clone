# Deployment and upgrade

Local HTTP/Mailpit Compose is a development environment. The production implementation and local release gates are recorded in the release report; configure real host endpoints and secrets before deployment.

## Configure a new host

Use Docker with its Linux engine and sufficient persistent storage. On a new installation, run `node scripts/configure.mjs` once and protect the generated `.env` and `data/s3.json`. Do not regenerate credentials for an existing volume without a deliberate migration.

Set PUBLIC_ORIGIN and ADMIN_ORIGIN to distinct HTTPS origins, RP_ID to the public hostname, S3_PUBLIC_ENDPOINT to the externally accessible HTTPS S3 endpoint, real SMTP settings and a verified EMAIL_FROM. Protect moderator and GitHub configuration as appropriate. Register the GitHub callback as `PUBLIC_ORIGIN/api/v1/connections/github/callback`; linking remains unavailable without credentials.

Provide HTTPS termination for all three hosts. The example host Caddyfile forwards to loopback-only ports 8080, 8081 and 9000. Set its ORBIT_PUBLIC_HOST, ORBIT_ADMIN_HOST and ORBIT_STORAGE_HOST. DNS, certificate provisioning and SMTP credentials require the operator's actual environment; local trusted-CA TLS allow/deny/removal was rehearsed; public DNS/ACME and SMTP deliverability require the deployed hosts.

Start with:

```sh
docker compose -f compose.yml -f compose.production.yml up -d --build
docker compose -f compose.yml -f compose.production.yml ps
```

The production configuration rejects HTTP public/admin/storage endpoints, mismatched RP hostname and local test SMTP. Its API cookies are Secure. Never expose internal API/delivery ports; proxy trust assumes exactly one direct trusted proxy. When introducing another load balancer, configure and validate its real-IP handling before relying on per-IP abuse controls.

SeaweedFS exposes private S3 APIs, not a public media bucket. Signed upload/download URLs work only when public/internal endpoints refer to the same bucket and credentials. The storage initializer configures private storage and browser PUT CORS for PUBLIC_ORIGIN.

App/server images run as node. API/delivery/worker/scheduler drop capabilities, use a read-only root filesystem, a temporary writable /tmp and startup health dependencies. PostgreSQL, Redis and object data use named persistent volumes. Protect the host and runtime networks; harden resource limits and secret management for the deployment's scale.

## Upgrade

1. Read migration and release notes; run staging checks against a restored snapshot.
2. Capture encrypted PostgreSQL and object-storage backups and securely preserve encryption/S3 credentials.
3. Build images from the lockfile. Run migration before new writers. Migrations use an advisory lock and transactions.
4. Start updated processes and check readiness, worker/scheduler health and delivery. Nginx refreshes Docker DNS upstream addresses after container replacement.
5. Run representative browser/API checks and compare latency, errors and queue backlog.
6. Keep previous images and the backup until the release is accepted.

The implementation uses forward SQL migrations. There are no automatic destructive down migrations. Image rollback is safe only if the previous version understands the migrated schema. Otherwise restore into isolated volumes, validate, and deliberately switch traffic.

There is no public deployment or automatic publication from this workspace. Optional Prometheus is enabled with `docker compose --profile observability up -d` and stays loopback-only on port 9090.

## Persistent data and secrets

Back up PostgreSQL, S3 objects and encryption credentials separately, with encryption and offsite retention. Redis contains rate limits/cache and does not replace the PostgreSQL durable outbox. Treat SMTP/provider tokens, .env, data/s3.json and backup files as secrets. Never commit them or copy them into image build contexts.

The identified key-ring rotation workflow is implemented in scripts/key-rotation.mjs; protect retained keys and verify re-encryption before retirement. Immutable local image preparation, upgrade and rollback are documented in upgrade.md. High-availability topology, public load targets, registry signing/publication and alert routing depend on the operator's deployment.
