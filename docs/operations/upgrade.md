# Upgrade and release procedure

Run install, format, lint, type, unit, SDK packaging and behavior gates. Back up PostgreSQL and private objects; protect the separate backup encryption key and application encryption key history offline. Validate append-only migration checksums and a clean/upgrade rehearsal. Never edit an applied SQL migration.

Build API/server roles, web, admin, PostgreSQL, reverse proxy and TLS images. Scan their exact image IDs, then run scripts/image-evidence.mjs. scripts/prepare-release.mjs verifies current runtime IDs equal the passing scans and creates local version/source-hash tags plus a Compose release overlay. Existing immutable tags are refused when content differs. Release preparation also requires passing browser, fault/performance, full-restore, TLS, WordPress, API-contract and security evidence, and binds their SHA-256 values into the manifest. Registry publication and artifact signing require the deployment operator's registry and signing identity; the script does not claim either.

The generated base overlay covers application and infrastructure images. The TLS overlay is separate and must be merged with the real TLS service configuration:

```sh
node scripts/prepare-release.mjs
node --env-file=.env scripts/verify-release.mjs
docker compose -f compose.yml -f reports/release/compose.release.json config --quiet
# On the production host after configuring HTTPS, SMTP and DNS:
docker compose -f compose.yml -f compose.production.yml -f compose.tls.yml -f reports/release/compose.release.json -f reports/release/compose.tls.release.json up -d --no-build
```

The verifier checks the current source snapshot, unchanged evidence, immutable images, local running containers, one-shot migration/storage initialization, readiness, public endpoints and anonymous dashboard denial. Rebuild and revalidate changed application images before preparing another source version.

Start migrations before the application, verify readiness, reload Nginx after replacement container IPs and verify HTTPS through the production edge. The container TLS override performs private on-demand authorization against current domain ownership and proof. Caddy handles certificate renewal. Public DNS/ACME and real SMTP must be configured for the deployed domain.

Retain the previous image manifest, encryption-key history and tested backup. Roll back application images only when compatible with the current database schema. SQL migrations are forward-only; a schema rollback uses the verified isolated recovery procedure and requires a deliberate reconciliation of changes since the backup. Versioned archives remain schema 2.0 with additive metadata fields.

Rotate OAuth/native application credentials, webhook secrets and DID/federation keys independently. Retire signing keys to retain old verification, then revoke them when verification must end. Revoked keys have encrypted private material erased. A federation node rotation changes its fingerprint; peers block and explicitly reapprove through a trusted operator channel. Document every operator change in the audit history.
