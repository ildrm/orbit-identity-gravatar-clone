# Extracted role catalog

All 81 named roles are preserved verbatim from section 1. Each has a concrete responsibility and deliverable. Applying these perspectives does not establish independent review or certification. Every milestone needs the relevant role outputs and evidence gates in implementation-prompt.md.

| Role                                  | Required responsibility/output                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Product Manager                       | Own product outcomes, complete scope and release acceptance; maintain the requirement/decision ledger.                       |
| Product Owner                         | Order dependent backlog items and define demonstrable acceptance criteria for every promised workflow.                       |
| Product Researcher                    | Validate real user problems and journeys; record research evidence and unresolved assumptions.                               |
| Competitive Intelligence Researcher   | Compare the specified product categories using current primary sources; separate market findings from implementation claims. |
| Identity Domain Analyst               | Define account/identity/persona/claim/proof distinctions and domain invariants with concrete examples.                       |
| Business Analyst                      | Map requirements, edge cases, errors and stakeholder rules to API and UI acceptance criteria.                                |
| Enterprise Product Strategist         | Define organization assertions, delegation and employment lifecycle without transferring personal profile ownership.         |
| Technical Program Manager             | Maintain milestone dependencies, risk/blocker ownership and the full release evidence ledger.                                |
| Developer Ecosystem Strategist        | Define usable application onboarding, integration journeys and supported ecosystem boundaries.                               |
| Product-Led Growth Strategist         | Review onboarding/discovery/share journeys with privacy-preserving measures and truthful empty states.                       |
| Principal Software Architect          | Own architecture coherence and document tradeoffs, module boundaries and production release constraints.                     |
| Solution Architect                    | Map complete journeys to services, runtime configuration and deployable infrastructure.                                      |
| Domain-Driven Design Architect        | Specify aggregates, invariants and domain actions; reject persistence-shaped public domain contracts.                        |
| Distributed Systems Architect         | Review leases, retries, consistency, idempotency, timeouts and dependency failure behavior.                                  |
| Data Architect                        | Define SQL relationships, uniqueness, retention and private/public projections; review migration/restore evidence.           |
| API Architect                         | Own versioned contracts, principals, errors, pagination, quotas, disclosure and compatibility.                               |
| Event-Driven Architecture Specialist  | Review transactional outbox/event schemas, deduplication, delivery semantics and dead-letter recovery.                       |
| Integration Architect                 | Define provider adapters, normalized contracts, token boundaries and reconnect/revocation semantics.                         |
| Federation Architect                  | Define instance trust/discovery, signed update/deletion messages and standards interoperability.                             |
| Senior NestJS Engineer                | Implement explicit domain modules, validated controllers/services and authorization inside mutations.                        |
| PostgreSQL Engineer                   | Implement parameterized transactions, constraints, indexes, locks and migration/concurrency/restore tests.                   |
| Redis Engineer                        | Implement atomic quotas and privacy-safe caching; verify fail-closed and recovery behavior.                                  |
| Queue/Worker Engineer                 | Implement durable jobs, lease renewal, bounded retries, idempotent effects and deletion/revocation rechecks.                 |
| Search Engineer                       | Index/query only opted-in permitted data; test hidden-value matching and stable pagination.                                  |
| Media Processing Engineer             | Bound actual raster decoding, remove metadata, quarantine sources and clean failed/deleted objects.                          |
| CDN/Edge Delivery Engineer            | Define cache keys, revocation/invalidation and delivery budgets without exposing private media.                              |
| Email Infrastructure Engineer         | Implement real deliverable mail templates, encrypted token transport, throttling and safe logs.                              |
| Integration Engineer                  | Implement live provider/domain/webhook workflows with bounded outbound network access and observable failures.               |
| Senior Next.js Engineer               | Implement SSR/client routes and real workflows while protecting HTML/RSC/metadata disclosure.                                |
| React Architect                       | Define component/state boundaries, loading/error/success transitions and predictable form updates.                           |
| Design-System Engineer                | Provide consistent accessible controls, responsive layouts, themes and reusable components.                                  |
| Frontend Performance Engineer         | Measure bundle/render/network behavior and representative mobile/desktop journeys.                                           |
| Frontend Security Engineer            | Review CSP, URL/content rendering, token handling, CSRF and browser-origin boundaries.                                       |
| IAM Architect                         | Separate account, identity, app and service principals; own permission and delegated authority matrices.                     |
| OAuth 2.0 Specialist                  | Implement reviewed OAuth flows with PKCE, exact redirects, narrow scopes, token expiry/rotation and revocation tests.        |
| OpenID Connect Specialist             | Gate optional OIDC on discovery/JWKS/nonce/userinfo/logout/key-rotation correctness and conformance evidence.                |
| WebAuthn/Passkey Specialist           | Use reviewed WebAuthn verification, RP/origin binding, required user verification and counter/recovery behavior.             |
| Digital Identity Standards Specialist | Validate claim/proof formats and explicit protocol promises against applicable primary standards.                            |
| Federation Specialist                 | Test signed inter-instance discovery/updates, replay protection, blocking and remote deletion.                               |
| W3C DID Specialist                    | Implement optional associations/resolution/proofs with document validation and key lifecycle.                                |
| Verifiable Credentials Specialist     | Review issuer/holder/verifier, expiry/status/revocation and correctly supported selective disclosure.                        |
| Applied Cryptography Engineer         | Review maintained primitives, entropy, digest/encryption use, key separation/rotation and signature comparisons.             |
| Application Security Engineer         | Threat-model API/browser boundaries and fix IDOR, injection, SSRF and privilege escalation with regressions.                 |
| Infrastructure Security Engineer      | Review images, users/capabilities, networks, TLS, secrets, supply chain and storage permissions.                             |
| Privacy Engineer                      | Trace claim values across every channel, metadata, cache, job, log and integration before serialization.                     |
| Threat Modeler                        | Maintain actors/assets/trust boundaries and abuse cases connected to controls and executed tests.                            |
| Abuse Prevention Engineer             | Define quotas, scraping/contact/media abuse defenses, moderation and safe user-visible recovery.                             |
| Anti-Fraud Engineer                   | Review impersonation, handle/domain takeover and misleading claims or verification presentation.                             |
| Trust & Safety Specialist             | Define reports, dispositions, blocks, appeals and abuse evidence minimization.                                               |
| Data Governance Specialist            | Own retention, export/import, deletion, legal hold and backup data lifecycle policies.                                       |
| Compliance Advisor                    | Identify actual deployment obligations and evidence needs; never infer legal certification from code.                        |
| Product Designer                      | Make identity/audience/publication decisions understandable through actual complete user flows.                              |
| UX Researcher                         | Validate tasks and friction with user evidence; record unvalidated assumptions and manual review gaps.                       |
| UI Designer                           | Review visual hierarchy, responsive typography, forms and clear published/private states.                                    |
| Interaction Designer                  | Review deliberate saves, confirmations, keyboard focus, feedback and interrupted/retry journeys.                             |
| Accessibility Specialist              | Combine automated WCAG checks with keyboard, screen reader, zoom, touch and contrast review.                                 |
| Internationalization Specialist       | Implement language/catalog/locale/date handling and Unicode/RTL journeys without translated policy errors leaking values.    |
| Technical SEO Specialist              | Gate canonical/robots/sitemap/structured metadata on current identity and field indexing policy.                             |
| Content Designer                      | Write truthful verification, consent, error, privacy and recovery copy without exposing implementation clutter.              |
| Developer Experience Engineer         | Validate onboarding, keys/consent, examples, request IDs and actionable integration errors.                                  |
| SDK Engineer                          | Ship typed clients with timeouts, bounded safe retries, pagination, safe redirects and contract tests.                       |
| CLI Engineer                          | Implement usable commands, secure environment credentials, stable output and failure exit codes.                             |
| API Documentation Specialist          | Publish actual route/schema/scope/quota/error/webhook contracts and unsupported boundaries.                                  |
| Developer Relations Engineer          | Provide working integration examples and support guidance verified against a running instance.                               |
| WordPress Integration Engineer        | Implement secure native avatar/user/comment/author/plugin flows and required ecosystem hooks with compatibility tests.       |
| QA Architect                          | Own risk-based behavioral coverage and ensure each product acceptance gate has evidence.                                     |
| Unit Testing Engineer                 | Test domain/policy/security edge cases without tests that merely mirror implementation internals.                            |
| Integration Testing Engineer          | Exercise real PostgreSQL/Redis/S3/SMTP/API boundaries, ownership and side-effect consistency.                                |
| E2E Testing Engineer                  | Automate real browser journeys, failure states, publication privacy and passkey/consent interactions.                        |
| Security Testing Engineer             | Test denied principals, replay, SSRF, injection, limits, media attacks and secret leakage.                                   |
| Accessibility Testing Engineer        | Run automated and manual accessibility checks on complete user/admin/public journeys.                                        |
| Performance/Load Testing Engineer     | Record representative data/hardware/cache/quotas and latency/error/throughput under steady, burst and stress loads.          |
| Chaos/Resilience Testing Engineer     | Exercise process/dependency outages, queue persistence, leases and recovery without fail-open disclosure.                    |
| DevOps Engineer                       | Provide pinned reproducible images, Compose setup, CI gates and safe environment configuration.                              |
| Platform Engineer                     | Define persistent storage, runtime isolation, scaling limits and operator interfaces.                                        |
| SRE                                   | Set and measure service levels; define alerting, failure recovery and operational readiness gates.                           |
| Observability Engineer                | Provide privacy-safe metrics/logs/traces, cardinality controls and queue/delivery visibility.                                |
| Database Reliability Engineer         | Verify backups, isolated restore, migrations, locks, connection limits and disaster recovery.                                |
| Release Engineer                      | Own build artifacts, scans/signatures, changelog, staging, deploy/rollback and honest release status.                        |
| Incident Response Engineer            | Document containment, evidence minimization, revocation, restore and communication procedures.                               |
| Technical Writer                      | Maintain accurate product/API/SDK/operator/security documentation with executed versus pending evidence.                     |
