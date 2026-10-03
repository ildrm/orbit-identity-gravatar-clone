# Orbit Identity

A privacy-first identity and avatar platform built with Next.js, NestJS, PostgreSQL, Redis and private S3-compatible storage. The original GPL-2.0 license is preserved.

The production implementation includes OAuth PKCE, federation and migration, account/identity merging, enterprise assertions, private credentials/DID, custom-domain routing, complete media exports/imports and digital legacy. [The release report](docs/release-report.md) records executed checks and deployment inputs; [the 132-section matrix](docs/product/feature-matrix.md) maps the original requirements.

## Run locally

Install Docker Desktop with its Linux engine and Node.js 24 LTS. Windows PowerShell users can use npm.cmd.

```sh
node scripts/configure.mjs
docker compose up -d --build
```

Configuration generates unique local secrets, preserves an existing .env, and writes ignored private S3 credentials. There are no seeded user passwords.

- App: [http://localhost:8080](http://localhost:8080)
- Moderator app: [http://localhost:8081](http://localhost:8081)
- Development inbox: [http://localhost:8025](http://localhost:8025)
- OpenAPI: [http://localhost:8080/api/v1/openapi.json](http://localhost:8080/api/v1/openapi.json)

Register, verify using Mailpit, sign in and create a private identity. Add claims/personas/blocks and review saved audience previews before publishing. Moderator access requires a verified allowlisted account in MODERATOR_EMAILS.

Compose stop/down preserve named volumes. Removing volumes erases persistent data.

## Capabilities

Verified password/passkey/TOTP authentication and account lifecycle; stable identity IDs/handle history; nine types, localized claims/provenance/personas/privacy; structured profile composition and previews; public SSR/search/machine/vCard/WebFinger/QR; immutable image editing and scheduled/default/persona/app/domain avatars; scoped private-avatar delivery; organization roles and enterprise assertions; OAuth public/confidential PKCE and native grants; selected private VC/DID proof/key lifecycle; approved signed federation/migration; GitHub private import/sync and verification; gated custom-domain TLS; aggregate analytics, notifications, private contact, moderation/appeals; versioned owner JSON/media archives, reviewed private import, revision restore, proved merge and digital legacy.

Protocol subsets, privacy boundaries and enabled integrations are documented. AI imagery, OIDC and GraphQL remain optional and disabled.

## Verify

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
node scripts/specification-check.mjs
node scripts/verify-sdk-packages.mjs
npm run test:integration
npm run test:authorization
node --env-file=.env scripts/wait-auth-window.mjs
npm run test:advanced
node --env-file=.env scripts/wait-auth-window.mjs
npm run test:trust
npm run test:operations
npm run test:e2e
node --env-file=.env scripts/openapi-check.mjs
node --env-file=.env scripts/migration-test.mjs
node --env-file=.env scripts/full-backup-test.mjs
node scripts/fault-suite.mjs
node scripts/security-scan.mjs
node scripts/image-evidence.mjs
node scripts/prepare-release.mjs
node --env-file=.env scripts/verify-release.mjs
```

Integration/browser tests use the running Compose stack and real Mailpit. Auth-heavy suites wait for normal quota expiry. Operational and fault suites create owned disposable databases/services; fault tests use an internal Docker network and a loopback forwarding fixture. They validate real retries/outages and separate workload measurements. Reports, test screenshots, local keys and backups stay ignored.

Playwright uses installed Chrome on Windows when available. Linux CI installs Chromium with npx playwright install --with-deps chromium. The real WordPress fixture runs after downloading/extracting the pinned official core. Development Mailpit and optional fixture services are separate from the production image scan scope.

## Production operation

Use HTTPS public/admin/storage origins, real SMTP, protected keys/storage and persistent backups. [Deployment](docs/operations/deployment.md), [upgrade](docs/operations/upgrade.md), [recovery](docs/operations/recovery.md) and [monitoring](docs/operations/monitoring.md) describe verification and rollback. Release preparation creates scan-matched immutable local tags and a Compose overlay; it does not push or publish them.

## Repository and documentation

| Directory                            | Responsibility                                 |
| ------------------------------------ | ---------------------------------------------- |
| apps/web, apps/admin                 | User and moderator Next.js apps                |
| apps/api                             | NestJS domain modules and control plane        |
| apps/delivery                        | Avatar/media delivery process                  |
| apps/worker, apps/scheduler          | Durable side effects, scheduling and retention |
| packages/contracts, packages/core    | Validated contracts, policy and infrastructure |
| packages/sdk-typescript, packages/ui | Packaged typed client and React components     |
| integrations                         | Python/PHP clients, CLI and WordPress plugin   |
| migrations                           | Append-only SQL changes                        |
| infrastructure                       | Images, proxy/TLS and monitoring               |
| tests, scripts                       | Behavioral gates and operational tools         |

Read [the optimized prompt](docs/product/implementation-prompt.md), [all 81 roles](docs/product/roles.md), [architecture](docs/architecture/design.md), [privacy](docs/security/privacy.md), [API](docs/api.md), [protocols](docs/protocols.md), [user guide](docs/user-guide.md) and [integration guide](integrations/README.md).
