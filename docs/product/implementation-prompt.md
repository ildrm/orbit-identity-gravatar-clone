# Production implementation prompt: Orbit Identity

Use this prompt together with [the original 132-section specification](original-prompt.md) and [the extracted role catalog](roles.md). The original numbered requirements remain authoritative. This refinement adds execution order, concrete role responsibilities and evidence requirements; it does not remove requirements.

## Objective and authority

Build and validate the complete universal identity, avatar, profile and developer platform specified in the source. Work in the existing repository, preserve user changes and its GPL-2.0 license, and follow applicable repository instructions. Implement authorized work directly. Ask only for information that cannot be inferred and materially affects a dependent decision.

Treat each role in the catalog as an active responsibility. Record which perspective reviewed an artifact, the defect found, its correction and the resulting evidence. Do not imply independent reviewers, legal certification or standards certification merely because one implementer applied several perspectives.

Do not reinterpret “production” as compilation, a polished demonstration, or a subset of the specification. The release remains blocked while mandatory requirements or applicable release gates are unmet.

## Required execution environment

Use strict TypeScript, current supported Next.js and NestJS, PostgreSQL, Redis, private S3-compatible storage, background workers, a scheduler and Docker Compose. Pin dependencies and images to verified versions. Record source URLs and the verification date. Keep application, delivery, worker and scheduler processes independently operable while retaining a modular monolith.

Use reviewed cryptographic and standards libraries. Native consent tokens must retain a distinct name and contract until OAuth/OIDC flows are implemented and tested for conformance. An unavailable provider or integration must show a truthful unavailable state.

## Mandatory artifacts before and during implementation

1. Preserve the source prompt and extract every named role without losing distinctions.
2. Build a requirement ledger keyed to sections 1–132 and their subrequirements. Each row records behavior, status, source files, API, UI, authorization, privacy, tests, documentation, operations and remaining work.
3. Model accounts, immutable identities, handles/history, memberships, personas, typed claims, provenance, freshness, relationships, provider connections, media, verification, applications, consent receipts, lifecycle and audit events.
4. Write ADRs for aggregate boundaries, SQL constraints, privacy information flow, authentication, outbox consistency, cache invalidation, media processing and standards interoperability.
5. Define a threat model with actors, assets, trust boundaries, abuse cases, controls and regression tests.
6. Design API contracts and user journeys before connecting UI components. Document errors, pagination, token handling, quotas, versioning and revocation.
7. Maintain a dependency-aware implementation plan and a release report. Record actual check outputs and failures, rather than planned checks as completed evidence.

## Role review checkpoints

Product and domain roles own requirement interpretation, useful journeys, enterprise needs and acceptance criteria. Architecture roles own invariants, module boundaries, transactions, integrations and protocol boundaries. Backend and frontend roles implement real domain behavior and user flows. Identity specialists review authentication, authorization, claim proofs, consent and standards. Security/privacy roles inspect information flow and abuse paths. Experience roles review interaction, accessibility, language, RTL and privacy-aware discovery. Ecosystem roles validate SDK, CLI and WordPress usability. Quality roles provide independent test dimensions. Operations roles verify reproducibility, observability, migration, recovery and incident handling.

Use the role catalog as the required checklist at each milestone. A role may block a release in its domain with a concrete unmet criterion. Resolve conflicts using user instructions, the original requirement, security/privacy invariants, and documented engineering evidence, in that order.

## Non-negotiable invariants

- An identity ID is permanent, opaque and independent of handles, provider usernames and email hashes. Historical handles remain reserved against impersonation.
- Accounts authenticate; memberships grant explicit actions on identities. Every mutation checks current permission inside its transaction where concurrency affects authority.
- Verification proves a specific claim through a stated method and issuer. It never establishes a universal “verified human” status.
- Claims use registered namespaces and typed values. Record source, immutable provider/issuer references, timestamps, expiry, revocation, actor and selected authority.
- Imported claims preserve provenance and cannot silently replace a manual authoritative value. Show conflicts and permit explicit selection.
- Personas override base claims. A private override blocks fallback to a public base value.
- Filter and transform claims before values enter an application response. Apply visibility, context, channel, scope, field allowlist, expiry and revocation to HTML, RSC payloads, JSON, machine/agent views, search, metadata, exports and integrations as appropriate.
- Visibility, discovery, search-engine indexing, API access, machine access and agent access remain independently controllable.
- Consent narrows identity, persona, fields, scopes, purpose and time. Check current consent and application state on every protected read. Revocation must invalidate new requests and pending disclosure jobs.
- Public/private resource existence must not reveal private email addresses, hidden claims or protected media. Clearly document that previously downloaded public data cannot be recalled.
- Persist the audit event and durable outbox record with the domain mutation. Jobs need leases, bounded retries, idempotency, recovery and observable dead letters.
- Validate media by actual decoding with size, dimension, pixel and frame limits. Re-encode allowed raster formats, remove metadata, quarantine originals and clean failed/deleted objects.
- Validate every outbound HTTPS target, resolve all addresses, reject private and special networks, pin the connection, reject redirects and enforce time/body bounds.
- Hash passwords with Argon2id. Store challenge/session/API-key digests; encrypt recoverable provider, MFA and delivery secrets. Require recent authentication for sensitive account changes.
- Enforce exact trusted mutation origins, secure cookies, CSP, rate limits and safe errors. Logs must omit credentials, tokens, query strings and claim values.
- No UI success without confirmed server behavior. Include honest empty, loading, validation, permission, unavailable, retry and success states.

## Dependency-aware milestones

| Milestone | Scope                                                                              | Exit evidence                                                                                                     |
| --------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1         | Repository, contracts, architecture, configuration, database, local infrastructure | Clean install/build, migrations, health checks, preserved license                                                 |
| 2         | Authentication, accounts, sessions, recovery, MFA, passkeys                        | Real mail and browser journeys; challenge/MFA replay, session and recovery denial tests                           |
| 3         | Stable identity, handles, personas, claims, privacy                                | IDOR/RBAC matrix; concurrent handle/claim constraints; private override and transformation leak tests             |
| 4         | Public profiles, resolver, search, delivery, media                                 | Representation/SEO leak tests; upload validation; origin revocation; cache and delivery load evidence             |
| 5         | Organizations, delegation, enterprise claims, providers, verification              | Invitation/role boundaries; specific claim proof; source authority and reconnect/revocation behavior              |
| 6         | Applications, consent, OAuth/OIDC, webhooks and developer platform                 | Real integration flows; standards conformance; exact redirect validation; rotation/revocation/replay tests        |
| 7         | Contact, profiles/blocks, business cards, QR, analytics, versioning                | Actual user workflows; recipient privacy; privacy-aware counts; rollback and expiration tests                     |
| 8         | Portability, merging, external migration, lifecycle, retention and legacy          | Complete archives and validated imports; merge safety; account/identity deletion; recovery and retention evidence |
| 9         | Credentials, DID, federation, self-hosting                                         | Interoperable proofs/resolution; independent instance journey; protocol conformance and trust boundaries          |
| 10        | Operations, accessibility, i18n, performance, resilience, documentation            | CI security gates, production HTTPS rehearsal, restores, load/chaos tests, manual review and release report       |

Every milestone requires its relevant role reviews. Implement unfinished features in dependency order without presenting excluded features as delivered.

## Test and release gates

Test observable behavior across real component boundaries. Unit tests cover domain/policy edge cases; integration tests cover actual PostgreSQL, Redis, S3 and SMTP; browser tests cover user journeys and accessibility. Negative tests must include unrelated account, anonymous user, every relevant organization role, app principal and service principal.

Check all privacy surfaces: HTML and serialized client payloads; JSON and exports; avatar and media URLs; search and pagination; metadata/canonical/robots; vCard, WebFinger, DID/credential, federation and agent representations; webhook and SDK output; logs, caches and asynchronous jobs.

Run clean migration and repeat-migration tests, SQL constraints/concurrency tests, encrypted backup and isolated restore tests, cache/outbox recovery and dependency outage tests. Test supported SDK and WordPress journeys against real API contracts.

Measure representative public/private profile, search, delivery, upload and worker workloads. State hardware, dataset, concurrency, cache state, quotas, error rate and latency percentiles. A local smoke test does not establish an internet-scale service level.

Automated WCAG checks supplement keyboard, screen-reader, zoom, contrast, touch, RTL and reduced-motion review. Do not describe automation alone as full accessibility certification.

On any failed gate: investigate the cause, fix the implementation or incorrect expectation, add a regression when appropriate and rerun affected checks. Never disable a gate, fabricate results, substitute mock-only behavior or silently ignore a failure.

The release report must distinguish passed, failed, unexecuted, external-input-dependent and not-implemented items. Include vulnerability/dependency/secret/container scans, reproducible images, deploy/rollback runbooks, privacy/security review, backups and evidence for every promised feature.

## Final delivery contract

Deliver the source, this refined prompt, complete role catalog, requirement ledger, ADRs, threat model, schema/API/SDK documentation, operator/user guides, executable checks, exact validation evidence and unresolved release blockers.

State the deployed local endpoints and how to create the first account. Keep credentials out of the response and repository. Do not publish externally, imply standards compliance, or declare completion without the required evidence and authorization.
