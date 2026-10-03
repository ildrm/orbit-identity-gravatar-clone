# SUPER-MEGA IMPLEMENTATION PROMPT

## Target execution environment

Execute this assignment using **GPT-6.1 Sol with `effort=high`**.

This is not a prototype, demo, proof of concept, or architecture exercise.

You are responsible for delivering a **production-ready, secure, maintainable, fully tested universal identity and profile platform** inspired by—but substantially broader than—Gravatar.

The system must use:

- **Next.js** for the web applications and user-facing frontend.
- **Nest.js** for backend APIs and application services.
- **TypeScript** across the primary application codebase.
- **PostgreSQL** as the authoritative relational database.
- **Redis** for caching, distributed coordination, throttling, ephemeral state, and job infrastructure where appropriate.
- **S3-compatible object storage** for media.
- **Docker / Docker Compose** for development, testing, and self-hosted deployment.
- Production-compatible container images and orchestration assumptions.
- Current stable production releases available at implementation time unless a compatibility constraint requires otherwise.

Do not hardcode a version merely because it appears in this prompt. Determine the current stable versions available to the implementation environment and document them.

---

# 1. OPERATING MODE

Act simultaneously as a coordinated multidisciplinary engineering and product organization.

The following roles are mandatory and must participate whenever their domain is relevant:

## Product and domain roles

- Product Manager
- Product Owner
- Product Researcher
- Competitive Intelligence Researcher
- Identity Domain Analyst
- Business Analyst
- Enterprise Product Strategist
- Technical Program Manager
- Developer Ecosystem Strategist
- Product-Led Growth Strategist

## Architecture roles

- Principal Software Architect
- Solution Architect
- Domain-Driven Design Architect
- Distributed Systems Architect
- Data Architect
- API Architect
- Event-Driven Architecture Specialist
- Integration Architect
- Federation Architect

## Backend roles

- Senior NestJS Engineer
- PostgreSQL Engineer
- Redis Engineer
- Queue/Worker Engineer
- Search Engineer
- Media Processing Engineer
- CDN/Edge Delivery Engineer
- Email Infrastructure Engineer
- Integration Engineer

## Frontend roles

- Senior Next.js Engineer
- React Architect
- Design-System Engineer
- Frontend Performance Engineer
- Frontend Security Engineer

## Identity roles

- IAM Architect
- OAuth 2.0 Specialist
- OpenID Connect Specialist
- WebAuthn/Passkey Specialist
- Digital Identity Standards Specialist
- Federation Specialist
- W3C DID Specialist
- Verifiable Credentials Specialist
- Applied Cryptography Engineer

## Security/privacy roles

- Application Security Engineer
- Infrastructure Security Engineer
- Privacy Engineer
- Threat Modeler
- Abuse Prevention Engineer
- Anti-Fraud Engineer
- Trust & Safety Specialist
- Data Governance Specialist
- Compliance Advisor

## Experience roles

- Product Designer
- UX Researcher
- UI Designer
- Interaction Designer
- Accessibility Specialist
- Internationalization Specialist
- Technical SEO Specialist
- Content Designer

## Developer ecosystem roles

- Developer Experience Engineer
- SDK Engineer
- CLI Engineer
- API Documentation Specialist
- Developer Relations Engineer
- WordPress Integration Engineer

## Quality roles

- QA Architect
- Unit Testing Engineer
- Integration Testing Engineer
- E2E Testing Engineer
- Security Testing Engineer
- Accessibility Testing Engineer
- Performance/Load Testing Engineer
- Chaos/Resilience Testing Engineer

## Operations roles

- DevOps Engineer
- Platform Engineer
- SRE
- Observability Engineer
- Database Reliability Engineer
- Release Engineer
- Incident Response Engineer
- Technical Writer

No role is merely advisory.

Relevant roles must actively inspect architecture, implementation, schemas, UX, security controls, tests, operational behavior, and documentation.

---

# 2. CORE PRODUCT VISION

Build an:

> Open, privacy-first, developer-friendly universal identity and profile infrastructure platform that allows people, organizations, teams, projects, services, applications, bots, brands, and communities to control how they are represented across the Internet.

The platform must not be limited to:

`email → avatar`

The fundamental model is:

```text
Permanent Identity
       │
       ├── Identifiers
       ├── Handles
       ├── Aliases
       ├── Domains
       ├── Personas
       ├── Claims
       ├── Relationships
       ├── Verification
       ├── Credentials
       ├── Media
       ├── Privacy Policies
       ├── Consent
       └── Provenance
```

Avatar serving is an important adoption mechanism, but the fundamental asset is the:

**identity graph + claim/provenance model + privacy policy layer + resolution infrastructure.**

---

# 3. NON-NEGOTIABLE ARCHITECTURAL PRINCIPLES

Follow these principles throughout the implementation.

## 3.1 Stable identity is not the username

Every identity receives an immutable opaque identifier.

Example:

```text
idn_01K...
```

Handles are mutable:

```text
@alice
```

Domains are mutable.

Email addresses are mutable.

Provider usernames are mutable.

The permanent identity ID must never depend on these mutable attributes.

All long-lived APIs, foreign keys, relationships, and audit records must use the immutable identity ID.

---

# 3.2 Email hashes are not the identity model

Do not expose unrestricted deterministic email-derived identity IDs.

Email resolution must be treated as a privacy-sensitive discovery function.

Prevent:

- email enumeration
- dictionary attacks
- bulk identity discovery
- unauthorized reverse lookup

Support controlled resolution through authenticated APIs and explicit policy.

Where keyed identifiers are useful, use a secure tenant-scoped keyed construction rather than pretending a simple public email hash provides confidentiality.

---

# 3.3 Modular monolith before unnecessary microservices

Do not create dozens of network services merely because the domain is large.

Use a modular NestJS control plane with strict domain boundaries.

Separate processes/services only where operational characteristics justify them.

At minimum distinguish:

```text
Control Plane
Delivery Plane
Background Processing
Scheduled Processing
```

The system must nevertheless allow modules to be extracted into independent services later.

Avoid shared-domain spaghetti.

---

# 3.4 Privacy by architecture

Privacy is not a settings page.

Privacy constraints must be enforced at:

- data access
- queries
- serializers
- API responses
- search indexes
- caching
- analytics
- webhooks
- exports
- federation
- machine-readable profiles
- AI/agent access
- developer integrations

Never fetch sensitive data and simply hide it in the frontend.

---

# 3.5 Verification verifies claims, not humans

Never calculate a universal:

```text
trust_score = 87
```

Do not classify a human as globally trustworthy/untrustworthy.

Verification applies to specific claims.

Example:

```text
GitHub account    VERIFIED
Domain ownership  VERIFIED
Employer          ISSUER_VERIFIED
Education         USER_ASSERTED
```

---

# 3.6 Provenance is first-class

All important identity information must know:

- who supplied it
- where it came from
- whether it was verified
- when it was last verified
- when it was last synchronized
- whether it is stale
- whether it expires
- who modified it

---

# 3.7 User ownership and portability

Users must be able to:

- inspect their information
- export it
- correct it
- revoke integrations
- remove data
- migrate their identity
- understand where their data is being used

Avoid intentional lock-in.

---

# 4. REPOSITORY ARCHITECTURE

Prefer a TypeScript monorepo.

A recommended conceptual structure is:

```text
/
├── apps/
│   ├── web/
│   ├── admin/
│   ├── api/
│   ├── worker/
│   ├── scheduler/
│   └── docs/
│
├── packages/
│   ├── ui/
│   ├── design-tokens/
│   ├── contracts/
│   ├── sdk-typescript/
│   ├── config/
│   ├── auth/
│   ├── validation/
│   ├── observability/
│   ├── testing/
│   └── eslint-config/
│
├── integrations/
│   ├── wordpress/
│   ├── php/
│   ├── python/
│   └── cli/
│
├── infrastructure/
│   ├── docker/
│   ├── reverse-proxy/
│   ├── monitoring/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   ├── security/
│   ├── operations/
│   └── product/
│
└── ...
```

Modify this only if architectural analysis demonstrates a better maintainable structure.

Use a workspace solution appropriate for the current Node ecosystem.

---

# 5. REQUIRED DOCKER SERVICES

Provide a complete development and self-hosting environment.

At minimum account for:

```text
web
admin
api
worker
scheduler
postgres
redis
object-storage
reverse-proxy
```

Development environments should additionally provide appropriate local utilities such as:

```text
mail testing
object-storage console
database inspection
```

Observability may include:

```text
OpenTelemetry Collector
Prometheus
Grafana
Loki or equivalent
```

Use profiles where appropriate so optional infrastructure does not burden every local run.

Docker requirements:

- multi-stage builds
- minimal runtime images
- non-root users
- health checks
- dependency health conditions
- graceful shutdown
- reproducible builds
- named volumes
- environment validation
- secrets not baked into images
- production and development targets
- correct signal handling
- read-only filesystem where practical
- resource guidance
- restart policies
- persistent data documentation

Provide:

```bash
docker compose up -d
```

as a functional deployment path.

---

# 6. DOMAIN MODEL

Design domain aggregates deliberately.

The following concepts must exist where appropriate.

## Accounts

Authentication/security account.

Distinguish the account from public identity.

Account properties may include:

- account ID
- authentication methods
- recovery mechanisms
- security state
- locale
- timezone
- lifecycle state

A single account may manage multiple identities where permitted.

---

# 7. IDENTITY TYPES

Support at minimum:

```text
PERSON
ORGANIZATION
TEAM
PROJECT
APPLICATION
SERVICE
BOT
BRAND
COMMUNITY
```

Design so new identity types can be introduced without destructive schema redesign.

---

# 8. IDENTIFIERS

Support:

- immutable internal ID
- public opaque identity ID
- primary handle
- historical handles
- aliases
- verified emails
- verified domains
- external provider identifiers
- optional DID identifiers
- organization-issued identifiers where applicable

Prevent identifier collisions.

Implement canonicalization rules carefully.

---

# 9. HANDLE SYSTEM

Support:

- unique handles
- normalized handles
- Unicode safety
- visually-confusable-character protections
- reserved usernames
- blocked words
- trademark/reservation mechanisms
- renaming
- history
- redirect behavior
- cooldown rules
- impersonation protection
- organization handles

Old profile URLs should redirect appropriately after handle changes.

Do not break external references.

---

# 10. PERSONAS

An identity can maintain multiple personas.

Examples:

```text
Personal
Professional
Developer
Creator
Gaming
Academic
Community
Custom
```

Personas must support inheritance.

Model:

```text
Base Identity
      │
      ├── Personal Persona
      ├── Professional Persona
      └── Developer Persona
```

Persona values override base values.

Avoid duplicating every profile field per persona.

Support:

- active/inactive personas
- default persona
- per-application persona
- optional domain rules
- persona-specific avatar
- persona-specific bio
- persona-specific links
- persona-specific privacy
- localized persona fields

Applications should explicitly request persona context rather than relying solely on unpredictable automatic selection.

---

# 11. CLAIM MODEL

Do not model all profile information as arbitrary flat columns.

Implement an extensible claim model.

A claim should support:

```text
id
identity_id
namespace
type
value
structured_value
persona_id
source
source_reference
verification_state
verification_method
visibility_policy
discoverability_policy
created_at
updated_at
source_updated_at
verified_at
last_checked_at
expires_at
revoked_at
actor
metadata
```

Examples:

```text
core:display_name
core:bio
professional:job_title
professional:employer
developer:github
developer:languages
creator:youtube
```

Use typed validation.

Do not turn the database into an uncontrolled key/value dump.

Frequently queried core attributes may be optimized separately while maintaining one semantic claim model.

---

# 12. CLAIM PROVENANCE

Every claim must identify provenance such as:

```text
USER_ENTERED
IMPORTED
PROVIDER_SYNC
DOMAIN_VERIFIED
ACCOUNT_VERIFIED
ORGANIZATION_VERIFIED
ISSUER_SIGNED
CREDENTIAL
SYSTEM_DERIVED
```

Users and applications must be able to distinguish them where permitted.

---

# 13. CLAIM FRESHNESS

Support:

```text
created_at
updated_at
verified_at
last_checked_at
source_updated_at
expires_at
```

Derive UX states such as:

```text
Current
Recently verified
Potentially stale
Expired
Revoked
Unable to revalidate
```

Never silently present expired verification as current verification.

---

# 14. CLAIM CONFLICT RESOLUTION

Multiple sources may disagree.

Example:

```text
Manual:
Company A

GitHub:
Company B

External import:
Company C
```

Do not silently overwrite information.

Provide:

- source priority
- owner override
- conflict UI
- audit trail
- synchronization strategy
- selected authoritative claim
- automatic conflict detection

Default policy should strongly protect deliberate manual changes from external sync overwrites.

---

# 15. RELATIONSHIP GRAPH

Support typed relationships between identities.

Examples:

```text
works_at
member_of
maintains
created
founded
owns
authored
contributes_to
represents
managed_by
parent_of
subsidiary_of
```

Relationships require:

- source
- verification state
- effective date
- expiration
- revocation
- visibility
- provenance

Relationships can be:

- unilateral claims
- mutually confirmed
- issuer confirmed
- externally verified

Do not imply stronger verification than exists.

---

# 16. AVATAR SYSTEM

Implement a complete avatar platform.

Support:

- uploaded avatars
- multiple avatar versions
- persona-specific avatar
- application-specific avatar
- domain-specific override where explicitly configured
- scheduled avatar
- temporary avatar
- avatar history
- restore
- automatic variant generation
- transparent images
- raster images
- vector images where securely handled
- animated formats subject to policy
- accessible alt text
- metadata
- content moderation
- avatar provenance

Image operations:

- crop
- resize
- rotate
- focal point
- face-aware cropping where implemented safely
- background removal
- background replacement
- quality control
- format conversion
- EXIF stripping
- orientation correction

Supported output formats should include appropriate modern web formats such as:

```text
JPEG
PNG
WebP
AVIF
SVG where appropriate
```

Avoid unsafe SVG execution.

---

# 17. GENERATED AVATARS

Provide deterministic generated avatars.

Support:

- stable seed
- multiple visual styles
- initials
- geometric identicons
- abstract patterns
- customizable colors
- customizable characteristics
- deterministic re-generation
- SVG generation
- raster rendering

Do not copy proprietary avatar artwork.

Create original or appropriately licensed styles.

The generated-avatar subsystem must be self-hostable.

---

# 18. AI AVATAR GENERATION

If an AI image-generation capability is enabled:

- make it optional
- clearly distinguish generated content
- obtain appropriate user consent
- maintain provenance
- protect against impersonation abuse
- apply moderation
- provide deletion
- provide opt-out
- avoid falsely presenting synthetic imagery as verified real-world identity evidence

AI imagery must never itself constitute identity verification.

---

# 19. MEDIA PLATFORM

Support:

- avatar
- header
- gallery
- project media
- organization branding

Use S3-compatible storage.

Implement:

- signed upload flow
- malware validation
- MIME validation
- magic-byte validation
- file size limits
- decompression-bomb protections
- secure filename handling
- immutable source objects
- generated variants
- storage lifecycle policies
- orphan cleanup

Never trust client-provided MIME types.

---

# 20. HIGH-VOLUME DELIVERY PLANE

Avatar delivery traffic may massively exceed dashboard traffic.

Design separately from the control plane.

Required features:

- global CDN compatibility
- immutable asset URLs
- cache keys
- `ETag`
- `Cache-Control`
- stale-while-revalidate
- conditional requests
- responsive variants
- resizing
- output negotiation
- CDN invalidation strategy
- hot-object optimization
- denial-of-service protection

Avoid database access on every avatar hit.

---

# 21. GRAVATAR-COMPATIBLE DELIVERY

Provide an optional compatibility interface enabling low-friction migration from existing Gravatar integrations.

Support a documented compatibility subset such as:

```text
/avatar/{identifier}
```

and appropriate familiar query concepts including:

```text
size
default
rating
```

Do not claim complete compatibility unless tests prove it.

Maintain separate modern native APIs.

---

# 22. UNIVERSAL RESOLVER

Create a resolver subsystem capable of identifying or discovering profiles from approved identifier types.

Potential resolver inputs:

- native identity ID
- handle
- verified domain
- authenticated email lookup
- GitHub
- GitLab
- Mastodon
- Bluesky
- WordPress
- Gravatar compatibility
- other modular providers

Use adapter architecture.

Example:

```text
Resolver
  ├── Native
  ├── Domain
  ├── Email
  ├── GitHub
  ├── GitLab
  ├── Mastodon
  ├── Bluesky
  └── ...
```

A provider adapter should implement a clear interface.

Include:

- timeout
- retries
- circuit breaking
- provider rate limits
- provider-specific cache TTL
- fallback rules
- provenance
- privacy policy
- failure classification

---

# 23. RESOLUTION FALLBACK

Allow configurable avatar fallback chains.

Example:

```text
Native avatar
   ↓
Verified connected-provider avatar
   ↓
Legacy provider
   ↓
Generated avatar
   ↓
Initials
```

Every returned result must include enough metadata to identify its origin when the requesting API scope permits it.

---

# 24. PROVIDER CONNECTIONS

Users can connect compatible external accounts.

Support:

- OAuth where available
- scoped permission
- provider refresh tokens
- token encryption
- revocation
- synchronization
- disconnect
- provider account metadata
- provider-specific errors

Never request broader scopes than necessary.

---

# 25. PROFILE SYNCHRONIZATION

Allow opt-in per-field synchronization.

Example:

```text
GitHub avatar      SYNC
GitHub bio         MANUAL
Repositories       SYNC
Location           NEVER IMPORT
```

Allow:

- one-time import
- continuous sync
- disabled sync
- explicit source preference
- synchronization history
- error state
- manual re-sync

Never silently overwrite manually authoritative fields.

---

# 26. VERIFICATION FRAMEWORK

Verification must be modular.

Support mechanisms such as:

- email challenge
- OAuth account proof
- reciprocal `rel=me`
- DNS TXT
- `.well-known`
- HTML metadata
- signed cryptographic challenge
- organization confirmation
- admin/manual review where justified
- Verifiable Credentials
- DID proof

Model verification evidence securely.

Do not expose secrets or private evidence publicly.

---

# 27. DOMAIN VERIFICATION

Implement robust domain ownership verification.

Support at minimum:

```text
DNS TXT
.well-known resource
```

Optional additional mechanism:

```text
HTML metadata
```

Track:

- challenge
- issue time
- verification time
- revalidation
- expiry
- failure
- revocation

Protect against DNS rebinding assumptions and domain transfers.

---

# 28. CUSTOM DOMAINS

Allow profiles to be served through verified custom domains.

Handle:

- domain onboarding
- DNS instructions
- automated certificate issuance
- certificate renewal
- validation
- canonical URLs
- redirects
- SSL failures
- custom-domain removal
- takeover prevention

Never allow abandoned-domain account takeover.

---

# 29. VERIFIABLE CREDENTIALS

Implement this as an advanced interoperable module.

Support standards-compatible credential flows where feasible.

Use cases:

- employment
- memberships
- certifications
- education
- project roles
- organization-issued statements

Handle:

```text
Issuer
Holder
Verifier
Credential
Status
Expiry
Revocation
```

Do not expose unnecessary credential contents publicly.

Use selective disclosure capabilities only where supported correctly.

---

# 30. DID INTEROPERABILITY

Support DID compatibility as an interoperability layer rather than requiring all users to understand decentralized identity.

Provide:

- DID association where supported
- DID resolution abstraction
- signed proofs
- document validation
- key rotation
- revocation handling

The platform's native identity model must work without DIDs.

---

# 31. PRIVACY POLICY ENGINE

Privacy controls must be field/claim aware.

Support visibility policies such as:

```text
PUBLIC
UNLISTED
AUTHENTICATED
CONNECTIONS
ORGANIZATION
SPECIFIC_APPLICATIONS
PRIVATE
```

Do not encode these only as UI options.

Enforce them in backend policy evaluation.

---

# 32. VISIBILITY VS DISCOVERABILITY

Represent these independently.

Possible dimensions:

```text
visible_to_public
searchable_in_platform
indexable_by_search_engines
available_via_api
available_to_authenticated_apps
embeddable
machine_readable
agent_accessible
```

A public profile does not automatically need to be searchable.

---

# 33. PRIVACY TRANSFORMATIONS

Support transformed disclosure.

Examples:

Exact location privately:

```text
Baku, Azerbaijan
```

Public disclosure:

```text
Azerbaijan
```

Birth date privately:

```text
1990-03-27
```

Public disclosure:

```text
March 27
```

Provide policy-driven transformations such as:

```text
FULL
GENERALIZED
ALIAS
REDACTED
HIDDEN
```

Avoid exposing sensitive source values in intermediate APIs.

---

# 34. OAUTH CONSENT

Third-party applications should request granular scopes.

Example:

```text
openid
identity.read
profile.basic
avatar.read
profile.developer
profile.professional
email.read
relationships.read
credentials.read
```

Scopes must be deliberate.

Never use one enormous `profile` scope to expose everything.

---

# 35. CONSENT RECEIPTS

Every authorization should create an understandable consent record.

Track:

- application
- user/identity
- scopes
- persona
- fields
- purpose where supplied
- granted timestamp
- expiry
- revocation
- last access

Expose this in the user's security dashboard.

---

# 36. APPLICATION ACCESS DASHBOARD

Provide a dashboard:

```text
Applications using my identity
```

For each application show:

- app name
- publisher
- requested persona
- granted scopes
- last used
- issued sessions/tokens where relevant
- revoke
- change permission
- reauthorize

---

# 37. CONTACT RELAY

Allow users to be contacted without publishing their private email.

Features:

- contact forms
- relay aliases
- rotating aliases
- blocking
- reply relay
- spam detection
- rate limiting
- abuse reporting
- optional CAPTCHA/risk challenges
- categories
- notification preferences

Protect recipient email addresses from disclosure.

---

# 38. AUTHENTICATION

Make account security a primary design requirement.

Support:

- email verification
- password authentication where retained
- passkeys/WebAuthn
- TOTP
- backup codes
- session management
- device/session list
- revoke session
- security events
- login notifications
- recovery flows
- secondary verified contact method
- account recovery key where appropriate

Prefer passkeys prominently.

Password storage must use a modern memory-hard password hashing configuration.

Never invent custom cryptographic authentication.

---

# 39. OPENID CONNECT PROVIDER

Implement an optional standards-compliant OIDC identity provider module.

Provide:

```text
Sign in with <Platform>
```

Handle correctly:

- authorization endpoint
- token endpoint
- userinfo
- discovery
- JWKS
- PKCE
- state
- nonce
- refresh token policies
- logout behavior
- client registration process
- redirect URI validation
- consent
- key rotation

Do not implement insecure shortcuts.

Use reviewed standards-compliant libraries.

---

# 40. API CLIENTS

Developers must be able to create applications.

Support:

- OAuth clients
- confidential/public clients
- API keys
- service accounts where appropriate
- redirect URIs
- allowed origins
- scopes
- environment separation
- key rotation
- revocation
- usage
- audit records

Secrets must only be shown when appropriate and stored securely.

---

# 41. ORGANIZATIONS

Implement organization identities.

Support:

- owners
- administrators
- members
- organization profile
- verified domains
- teams
- invitations
- role assignments
- membership history
- delegated administration
- managed claims
- organization verification
- audit logs
- organization-specific policies

---

# 42. ENTERPRISE-MANAGED CLAIMS

Allow organizations to issue/manage claims without taking control of the entire personal profile.

Example:

```text
Display name    user controlled
Avatar          user controlled
Bio             user controlled

Employer        organization asserted
Job title       organization asserted
Department      organization asserted
Employment      organization verified
```

When employment ends, the organization-issued claim can become expired/revoked without deleting the person's identity.

---

# 43. RBAC AND DELEGATION

Support fine-grained roles such as:

```text
OWNER
ADMIN
EDITOR
PROFILE_MANAGER
BRAND_MANAGER
HR_MANAGER
DEVELOPER
AUDITOR
MODERATOR
```

Use explicit permissions.

Do not scatter authorization conditionals throughout controllers.

Implement centralized policy/authorization mechanisms.

---

# 44. PROFILE MANAGEMENT DELEGATION

A profile may be managed by authorized parties.

Examples:

- executive profile managed by communications staff
- brand profile managed by marketing
- project profile managed by maintainers
- organization profile managed by multiple admins

Every action must maintain actor-level auditability.

---

# 45. PROFILE BLOCK SYSTEM

Public profiles should be composition-based.

Core blocks should support:

- biography
- links
- social accounts
- contact
- projects
- portfolio
- gallery
- video
- audio
- articles
- RSS/Atom content
- GitHub repositories
- credentials
- QR
- booking
- donation/payment links
- organization membership
- custom rich-content block subject to security restrictions

Blocks need:

- ordering
- visibility
- persona association
- localization
- enable/disable
- configuration
- validation

Architect for a future extension ecosystem without allowing arbitrary unsafe server-side code.

---

# 46. LINK-IN-BIO MODE

Allow a profile to act as a sophisticated link-in-bio page.

Support:

- links
- featured links
- social icons
- portfolio
- projects
- embeds
- articles
- newsletter link
- booking link
- contact
- donations
- products or commerce links
- analytics
- themes
- custom domain

Commerce-specific business logic should remain modular and not pollute the identity core.

---

# 47. THEMES

Allow customization while preserving accessibility.

Support:

- light/dark
- colors
- typography
- spacing presets
- background
- header
- block styles
- organization branding
- preview
- responsive rendering

If custom CSS is supported, isolate/sanitize it carefully.

Do not allow arbitrary script injection.

---

# 48. BUSINESS CARD FUNCTIONALITY

Provide digital business card functionality.

Support:

- profile QR
- persona QR
- vCard download
- printable card assets
- NFC destination compatibility
- short URL
- custom domain
- contact save
- dynamic destination

Optionally support wallet-card representations where implementation ecosystems allow it.

---

# 49. DYNAMIC QR SYSTEM

Provide managed QR records rather than only static images.

Types:

- profile
- persona
- contact
- URL
- project
- organization
- campaign

Support:

- dynamic redirect
- expiration
- password protection where justified
- campaign parameters
- scan analytics
- destination modification
- revocation

Prevent QR redirects from becoming an unrestricted malicious-link service.

---

# 50. ANALYTICS

Implement privacy-preserving aggregated analytics.

Possible metrics:

- profile views
- avatar requests
- QR scans
- profile block interactions
- link clicks
- requesting applications
- broad geographic distribution
- device category
- persona usage

Avoid:

- cross-site fingerprinting
- hidden invasive tracking
- unnecessary unique visitor correlation

Use retention policies.

Respect privacy configuration.

---

# 51. PROFILE ACCESS ACTIVITY

Users should be able to inspect relevant application/API activity.

Examples:

```text
Developer Forum
requested:
  avatar
  developer profile
  GitHub

Last access:
2026-10-02
```

Avoid overwhelming users with every CDN image request.

Aggregate where appropriate.

---

# 52. MACHINE AND AGENT ACCESS POLICIES

Do not create a narrow hardcoded “AI profile.”

Instead provide policy-controlled machine representations.

Possible consumers:

```text
browser
search_engine
application
automation
AI_agent
```

Allow identity owners to define whether particular information is:

- human visible
- indexable
- API visible
- machine readable
- agent accessible

Respect these policies in output representations.

---

# 53. MACHINE-READABLE REPRESENTATIONS

Support standards-oriented representations as appropriate:

- HTML
- JSON
- JSON-LD
- vCard
- h-card
- WebFinger
- Markdown representation
- OpenGraph metadata
- Schema.org identity/person/organization markup where semantically correct

Use HTTP content negotiation where sensible.

---

# 54. WEBFINGER

Implement standards-compatible WebFinger discovery where appropriate.

Support correct:

```text
/.well-known/webfinger
```

behavior.

Handle:

- canonical subject
- aliases
- links
- content type
- security
- privacy policy

Do not leak non-public identifiers.

---

# 55. `rel=me` AND WEB OWNERSHIP

Support reciprocal link verification.

Allow a user to establish ownership/control relationships between:

- platform identity
- personal website
- compatible external profiles

Provide verification status and revalidation.

---

# 56. INTERNATIONALIZATION

Internationalization is a first-class requirement.

Do not assume Western naming conventions.

Support:

- display name
- preferred name
- native-script name
- transliteration
- localized biography
- localized titles
- locale
- timezone
- localized profile blocks

Do not require:

```text
first_name + last_name
```

as the universal human-name model.

Support RTL correctly.

Use locale-aware formatting.

---

# 57. ACCESSIBILITY

Target WCAG 2.2 AA at minimum.

Cover:

- keyboard navigation
- focus states
- semantic HTML
- form labels
- screen readers
- contrast
- zoom
- reduced motion
- error descriptions
- modal accessibility
- sortable components
- drag/drop alternatives
- avatar alt text
- QR accessibility descriptions

Automated accessibility tools are insufficient.

Include manual review procedures.

---

# 58. TECHNICAL SEO

Public profile pages should support:

- canonical URLs
- metadata
- OpenGraph
- structured data
- sitemap inclusion rules
- `index/noindex`
- `follow/nofollow`
- robots directives
- redirects
- localization/hreflang where appropriate
- performant rendering
- correct status codes

Privacy configuration overrides SEO.

Private or unlisted identities must never accidentally enter sitemaps.

---

# 59. SEARCH

Implement internal profile search subject to privacy policy.

Use PostgreSQL capabilities initially unless scale analysis proves dedicated search infrastructure necessary.

Consider:

- full-text search
- trigram search
- ranking
- handle lookup
- organization search
- project search

Do not index private claims.

Provide indexing pipelines that receive only permitted fields.

---

# 60. ANTI-ENUMERATION AND ANTI-SCRAPING

Protect identity infrastructure from automated harvesting.

Implement:

- authenticated bulk interfaces
- anonymous rate limits
- IP/reputation controls
- API client quotas
- suspicious-query detection
- email enumeration protection
- search throttling
- provider resolver throttling
- credential stuffing defense
- abuse response

Avoid blocking legitimate accessibility tools and search engines indiscriminately.

---

# 61. IDENTITY LIFECYCLE

Support states such as:

```text
PENDING
ACTIVE
RESTRICTED
LOCKED
SUSPENDED
MERGED
TRANSFERRED
MEMORIALIZED
DELETED
```

Define behavior for:

- authentication
- API access
- profile URL
- avatar endpoint
- redirects
- search
- retention
- export
- deletion

Create a formal lifecycle state machine.

---

# 62. ACCOUNT/IDENTITY MERGING

Implement secure merging.

Require proof of control.

Never automatically merge people merely due to similar metadata.

Merging should preserve:

- IDs
- aliases
- redirects
- claims
- verification
- history
- relationships
- API references
- avatars
- audit trail

Record merge provenance.

---

# 63. PORTABILITY

Provide complete exports.

A migration bundle should conceptually support:

```text
manifest.json
identity.json
personas/
claims/
relationships/
avatars/
media/
credentials/
verification/
links/
settings/
```

Provide:

- JSON export
- media archive
- vCard export
- machine-readable claim export
- import validation
- versioned export schema

Document the format publicly.

---

# 64. MIGRATION FROM EXTERNAL SERVICES

Where provider APIs, licenses, and terms permit, support migration/import from appropriate services.

Potential imports:

- Gravatar
- GitHub
- GitLab
- public personal website
- supported identity sources

Allow:

```text
one-time import
optional synchronization
disconnect
```

Do not scrape against provider terms.

---

# 65. SELF-HOSTING

Produce a self-hostable edition.

Requirements:

- Docker Compose
- documented environment variables
- PostgreSQL
- Redis
- S3-compatible storage
- SMTP support
- reverse proxy
- TLS documentation
- upgrade process
- backup
- restore
- migrations
- scaling instructions

Core functionality must not secretly depend on proprietary cloud infrastructure.

Cloud-only integrations may remain optional modules.

---

# 66. FEDERATION

Implement federation as a modular advanced capability.

Design carefully around:

- node discovery
- server identity
- trust boundaries
- signed messages
- replay protection
- remote identity resolution
- remote profile caching
- update propagation
- moderation
- blocking
- data deletion
- account migration
- compatibility
- protocol versioning

Do not conflate federation with simple API access.

Document the protocol.

If implementing a custom protocol, provide rigorous reasoning for every custom mechanism and prefer existing standards where suitable.

---

# 67. WEBHOOKS

Provide production-grade webhooks.

Events may include:

```text
identity.created
identity.updated
identity.merged
identity.deleted

persona.created
persona.updated

claim.created
claim.updated
claim.verified
claim.expired
claim.revoked

avatar.updated

relationship.created
relationship.updated
relationship.revoked

credential.issued
credential.revoked

consent.updated
```

Webhook functionality must include:

- signed payloads
- timestamp
- event ID
- delivery ID
- retries
- exponential backoff
- replay
- delivery logs
- dead-letter handling
- timeout
- endpoint disablement
- secret rotation
- test event
- idempotency documentation

---

# 68. REST API

Provide a carefully versioned public REST API.

Use:

```text
/api/v1
```

or an equivalent explicit versioning strategy.

Provide:

- predictable resources
- standardized errors
- pagination
- filtering
- sorting
- idempotency where relevant
- rate-limit headers
- correlation IDs
- validation
- authorization
- OpenAPI documentation

Avoid leaking internal database schemas directly.

---

# 69. GRAPHQL

GraphQL may be provided for advanced integrations if analysis confirms sufficient value.

If implemented:

- strict authorization per field
- complexity limiting
- depth limiting
- query cost controls
- persisted-query support consideration
- introspection policy
- DataLoader/batching
- no private-field leakage

REST remains first-class.

---

# 70. SDKs

Provide at least:

- TypeScript/JavaScript SDK
- PHP SDK
- Python SDK

Design generated/shared contracts where useful.

SDKs must provide:

- typed errors
- pagination helpers
- retries only where safe
- timeout handling
- authentication
- version compatibility
- examples

Later-ready architecture should support:

```text
Go
Java
.NET
Ruby
Swift
Kotlin
```

---

# 71. UI COMPONENT SDK

Provide reusable frontend components such as:

```tsx
<IdentityAvatar />
<ProfileCard />
<ProfileHoverCard />
<IdentityLink />
<PersonaPicker />
<ConsentDialog />
```

Components must be:

- accessible
- typed
- tree-shakeable where practical
- themeable
- secure
- framework/documentation friendly

---

# 72. CLI

Provide a CLI for developers/admins.

Potential commands:

```text
login
whoami
identity get
profile export
app create
webhook test
resolver lookup
domain verify
token inspect
```

Never print secrets unintentionally.

---

# 73. WORDPRESS INTEGRATION

Build an official WordPress plugin.

Support:

- avatar replacement
- Gravatar-compatible drop-in mode
- comments
- user profiles
- author boxes
- Gutenberg blocks
- WooCommerce compatibility where relevant
- BuddyPress/BuddyBoss integration where possible
- developer filters/actions
- REST integration
- WP-CLI commands
- configurable fallback

Follow WordPress coding/security standards.

Do not require theme modifications for basic migration.

---

# 74. DEVELOPER PORTAL

Build a first-class developer portal.

Include:

- application registration
- API keys
- OAuth clients
- usage
- scopes
- webhook management
- API logs
- documentation
- quickstarts
- sandbox identities
- API explorer
- webhook debugger
- webhook replay
- SDK references
- migration guides

Developer experience is a product, not an afterthought.

---

# 75. PROFILE SCHEMA EXTENSIONS

Use namespaced extensibility.

Examples:

```text
core:bio
developer:github
creator:youtube
org:department
```

Allow future third-party schema definitions through controlled registration.

Schemas must specify:

- type
- validation
- display semantics
- privacy behavior
- indexing behavior
- localization
- version

Do not execute third-party arbitrary backend code.

---

# 76. SECURITY ARCHITECTURE

Create a formal threat model before completing implementation.

At minimum analyze:

- account takeover
- session theft
- OAuth attacks
- CSRF
- XSS
- SSRF
- SQL injection
- command injection
- file upload attacks
- SVG attacks
- image parser attacks
- webhook spoofing
- replay attacks
- cache poisoning
- IDOR/BOLA
- privilege escalation
- confused deputy problems
- DNS verification attacks
- abandoned-domain takeover
- email enumeration
- scraping
- API abuse
- provider token theft
- credential forgery
- federation impersonation
- supply-chain attacks
- secret leakage
- rate-limit bypass
- denial of service

Produce threat-model documentation and tests for high-priority controls.

---

# 77. SECURITY HEADERS

Configure appropriate headers including where applicable:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
Cross-Origin-Opener-Policy
Cross-Origin-Resource-Policy
```

Do not enable values mechanically.

Design them based on application requirements.

---

# 78. CSRF / CORS

Use correct architecture for:

- cookie authentication
- CSRF protection
- API bearer tokens
- CORS
- trusted origins

Never use wildcard origins together with credentials.

---

# 79. RATE LIMITING

Implement layered limits.

Dimensions may include:

- IP
- account
- identity
- API client
- endpoint
- resolver provider
- organization
- anonymous/authenticated

Use different limits for:

- login
- recovery
- resolution
- profile views
- search
- API mutation
- uploads
- contact relay

---

# 80. AUDIT LOGGING

Security-relevant actions must generate append-oriented audit records.

Examples:

- authentication
- passkey changes
- recovery changes
- email changes
- domain verification
- OAuth consent
- API key creation
- token revocation
- profile delegation
- organization role changes
- credential issuance
- account merge
- export
- deletion

Audit records require:

- actor
- action
- subject
- timestamp
- request/correlation ID
- source category
- appropriate IP/device information subject to privacy policy
- result
- metadata

Do not write secrets into logs.

---

# 81. ABUSE AND MODERATION

Implement:

- report profile
- report impersonation
- report spam
- report malicious links
- report stolen images
- organization/trademark dispute workflows
- moderator queues
- evidence
- disposition
- appeals
- audit trail
- suspension/restriction tools

Use risk-based moderation.

Do not indiscriminately remove identity data without traceable workflow.

---

# 82. LINK SAFETY

Public profiles can become phishing surfaces.

Implement:

- URL normalization
- protocol allowlist
- dangerous scheme rejection
- malicious URL detection
- suspicious redirect protection
- optional warning interstitials
- report link
- link reputation integration abstraction

---

# 83. DATA RETENTION AND DELETION

Define retention policies for:

- identity data
- media
- authentication events
- audit logs
- analytics
- webhook delivery
- contact relay
- deleted accounts
- backups

Provide correct deletion/anonymization workflows.

Document what cannot be immediately removed from immutable operational/security records and why.

---

# 84. BACKUP AND RESTORE

Provide:

- PostgreSQL backup strategy
- object-storage backup/versioning
- encryption
- retention
- restore procedures
- restoration tests
- disaster recovery documentation

Backups that have never been restored in testing are not considered validated.

---

# 85. PROFILE VERSIONING

Every meaningful profile mutation should produce a revision or auditable change set.

Provide:

- revision ID
- timestamp
- actor
- source
- diff
- restore
- comparison

Avoid duplicating huge binary media into every revision.

---

# 86. DIGITAL LEGACY

Implement or architect a clearly defined optional digital legacy module.

Possible outcomes:

```text
MEMORIALIZE
FREEZE
TRANSFER_TO_CUSTODIAN
ARCHIVE
DELETE
```

Require strong safeguards.

Do not trigger legacy actions based merely on inactivity without an explicit policy and verification workflow.

---

# 87. NOTIFICATIONS

Provide configurable notifications.

Channels may include:

- in-app
- email
- webhook for organizations

Events include:

- login
- new device
- security changes
- verification
- domain failure
- provider sync failure
- application authorization
- data export completion
- moderation action
- account lifecycle change

Avoid notification spam.

---

# 88. EMAIL SYSTEM

Use template-based transactional email.

Requirements:

- queue
- retries
- provider abstraction
- idempotency
- localization
- unsubscribe handling for non-essential communications
- bounce handling
- abuse complaint handling
- SPF/DKIM/DMARC deployment documentation

---

# 89. JOB SYSTEM

Use a robust background job architecture.

Appropriate jobs:

- media processing
- provider synchronization
- verification rechecks
- emails
- webhook delivery
- analytics aggregation
- QR processing
- export generation
- import
- cleanup
- search indexing

Requirements:

- retry policy
- idempotency
- dead-letter behavior
- monitoring
- job timeout
- concurrency control
- deduplication where needed

---

# 90. SCHEDULER

Scheduled workflows include:

- claim freshness checks
- credential expiry
- provider revalidation
- domain verification
- cleanup
- retention enforcement
- scheduled avatars
- temporary avatar expiry
- analytics aggregation

Prevent duplicate scheduled execution in horizontally scaled deployments.

---

# 91. DATABASE DESIGN

Use PostgreSQL.

Use a production-quality migration system.

Recommended ORM/data layer may be Prisma, TypeORM, or another mature Nest-compatible option; select based on actual requirements and document the ADR.

Do not force the domain to fit an ORM limitation.

Implement:

- foreign keys
- constraints
- unique indexes
- partial indexes where valuable
- transactional integrity
- optimistic/pessimistic concurrency only where appropriate
- database migrations
- safe production migrations
- indexes verified by query behavior

Avoid EAV abuse.

---

# 92. TRANSACTIONS AND CONSISTENCY

Define transaction boundaries explicitly.

For external side effects use patterns such as:

- transactional outbox
- idempotent consumers
- durable event records

where appropriate.

Do not publish critical events before the database transaction is durable.

---

# 93. CACHING

Design cache layers intentionally.

Cache examples:

- public profiles
- avatar metadata
- provider resolution
- verification status
- rate-limit state
- public identity aliases

Define:

- TTL
- invalidation
- stale behavior
- cache keys
- tenant boundaries
- security implications

Never cache private user-specific responses under unsafe shared keys.

---

# 94. OBSERVABILITY

Use structured observability.

Provide:

- structured logs
- traces
- metrics
- correlation IDs
- queue metrics
- database metrics
- cache metrics
- HTTP latency
- error rates
- media pipeline metrics
- resolver/provider metrics
- webhook metrics
- authentication metrics

Prefer OpenTelemetry-compatible instrumentation.

---

# 95. SERVICE LEVEL INDICATORS

Define SLIs for critical functions.

Examples:

- avatar delivery availability
- avatar latency
- API availability
- authentication success latency
- identity resolution latency
- webhook delivery success
- media processing delay
- worker queue lag

Provide recommended SLOs.

Do not pretend all subsystems require identical availability targets.

---

# 96. PERFORMANCE

Set concrete performance budgets.

Frontend:

- minimize JavaScript
- optimize RSC/server rendering appropriately
- code splitting
- image optimization
- avoid layout shift
- strong Core Web Vitals

Backend:

- efficient queries
- no N+1
- connection pooling
- pagination
- streaming where necessary
- queue heavy tasks
- caching
- memory limits

Delivery:

- edge/CDN caching
- minimal origin traffic
- optimized transformations

---

# 97. NEXT.JS REQUIREMENTS

Use modern Next.js architecture.

Prefer:

- App Router
- server-rendered public profile pages
- server components where beneficial
- client components only where interaction requires them
- route-level loading/error handling
- proper metadata
- strict TypeScript
- accessible forms
- secure authentication integration

Do not duplicate backend domain logic in Next.js.

NestJS remains the authoritative application/domain API.

---

# 98. NESTJS ARCHITECTURE

Organize by domain rather than technical dumping grounds.

Possible modules:

```text
Auth
Accounts
Identities
Handles
Personas
Claims
Relationships
Media
Avatars
Profiles
Organizations
Verification
Credentials
Providers
Resolver
Privacy
Consent
Applications
OAuth
OIDC
Domains
QR
ContactRelay
Analytics
Search
Webhooks
Imports
Exports
Federation
Moderation
Notifications
Audit
```

Each module should have clear:

- domain
- application
- infrastructure
- interface boundaries

Avoid giant services.

Avoid fat controllers.

Controllers coordinate HTTP concerns.

Domain/application services own business rules.

Repositories abstract persistence where justified.

---

# 99. CLEAN CODE REQUIREMENTS

Require:

- cohesive modules
- explicit naming
- small focused functions
- no unexplained magic constants
- no unnecessary abstractions
- no `any` without documented exceptional reason
- strict linting
- deterministic formatting
- DTO validation
- consistent error handling
- dependency inversion at meaningful boundaries
- design patterns only when they solve a real problem

Do not over-engineer.

---

# 100. DESIGN PATTERNS

Use patterns where justified, including potentially:

- Strategy for provider resolvers
- Adapter for external providers
- Factory for avatar generators
- Policy/Specification for visibility rules
- State Machine for lifecycle
- Command/Handler for important mutations
- Repository for persistence boundaries
- Outbox for reliable integration events
- Observer/Event pattern for domain changes
- Chain of Responsibility for avatar fallback
- Template Method where provider workflows share structure

Document important decisions.

---

# 101. UX PRINCIPLES

The platform is inherently complex.

Do not expose internal complexity directly.

The main user experience should answer:

```text
Who am I?
What information do I share?
Which persona is being used?
Who can see it?
Who verified it?
Which applications can access it?
Where did this information come from?
```

Use progressive disclosure.

Advanced settings must not overwhelm normal users.

---

# 102. DASHBOARD UX

Provide primary areas such as:

```text
Overview
Identity
Personas
Profile
Avatar & Media
Connections
Verification
Credentials
Privacy
Applications
Organizations
QR & Sharing
Analytics
Security
Developer
Settings
```

Conduct UX review on navigation before freezing it.

---

# 103. PROFILE EDITING

Provide a polished editor supporting:

- preview
- autosave or deliberate save semantics
- undo where feasible
- validation
- persona selection
- localized fields
- drag/drop blocks
- keyboard alternatives
- responsive preview
- public/private visibility preview

Allow the user to preview the profile as:

```text
Public visitor
Specific application
Specific persona
Search engine
```

where feasible.

---

# 104. SECURITY UX

Security workflows must explain:

- what is happening
- why
- consequences
- recovery options

Do not produce ambiguous messages such as:

```text
Authentication failed
```

when a safe, actionable explanation is possible.

Do not leak account enumeration through authentication errors.

---

# 105. API ERROR MODEL

Define a consistent machine-readable error model.

Include:

```text
code
message
status
request_id
details where safe
```

Do not expose stack traces in production.

---

# 106. DOCUMENTATION

Produce:

```text
README
CONTRIBUTING
SECURITY
architecture overview
deployment guide
self-hosting guide
API docs
SDK docs
provider integration guide
webhook guide
WordPress guide
privacy architecture
threat model
backup/restore guide
incident guide
upgrade guide
federation guide
```

Create ADRs for major technical decisions.

---

# 107. TESTING STRATEGY

Testing is mandatory.

Do not declare a feature implemented merely because it compiles.

Use:

```text
unit tests
integration tests
contract tests
API tests
E2E tests
authorization tests
security tests
accessibility tests
visual regression tests where valuable
performance tests
load tests
migration tests
backup/restore tests
```

---

# 108. AUTHORIZATION TEST MATRIX

Create systematic tests across:

```text
anonymous
owner
other user
organization member
organization admin
delegated editor
OAuth application
service account
moderator
system worker
```

for every sensitive resource.

Test both:

```text
allowed
denied
```

cases.

This is mandatory.

---

# 109. PRIVACY LEAK TESTS

Write explicit tests proving that:

- private claims never appear publicly
- unlisted profiles are not indexed
- search excludes private claims
- caches do not cross privacy boundaries
- OAuth scopes restrict API fields
- revoked applications lose access
- exports contain correct user-owned data
- machine-readable views obey policy
- federation does not leak hidden information

---

# 110. SECURITY TESTING

Automate checks for:

- dependency vulnerabilities
- secret leakage
- unsafe container configuration
- broken access control
- malicious upload
- common XSS payloads
- CSRF
- SSRF
- webhook spoofing
- replay
- OAuth redirect attacks
- enumeration
- brute force
- rate-limit bypass attempts

Use appropriate security tooling in CI.

---

# 111. ACCESSIBILITY TESTING

Include:

- automated a11y testing
- keyboard-only workflows
- screen-reader sanity validation
- focus-management review
- color-contrast checks
- reduced-motion testing

---

# 112. PERFORMANCE TESTING

Load test separately:

```text
avatar CDN/origin
public profiles
identity resolver
authentication
search
API read
API write
webhooks
workers
```

Measure:

- p50
- p95
- p99
- throughput
- error rate
- database utilization
- Redis utilization
- queue lag
- memory
- CPU

Do not optimize from intuition alone.

---

# 113. DATABASE TESTS

Test:

- migrations from clean database
- upgrades from prior migration state
- rollback strategy where supported
- constraints
- race conditions
- concurrent handle registration
- merge transactions
- consent revocation
- credential revocation
- idempotent workers

---

# 114. RESILIENCE TESTING

Test failures of:

- PostgreSQL connection
- Redis
- object storage
- SMTP
- external providers
- DNS verification
- webhook receivers
- worker crash
- scheduler restart

The application should fail predictably and recover safely.

---

# 115. CI PIPELINE

CI must include at minimum:

```text
install
format check
lint
type check
unit tests
integration tests
build
security scan
container build
container scan
E2E tests
```

Apply caching appropriately.

Do not allow failing tests to be ignored.

---

# 116. CD AND RELEASES

Prepare production release architecture.

Include:

- immutable image tags
- migration strategy
- health checks
- readiness
- rolling update assumptions
- rollback
- release notes
- schema compatibility
- secrets management
- deployment verification

---

# 117. QUALITY GATE LOOP

For every major feature:

1. Product Manager confirms requirement.
2. Domain Analyst checks semantic correctness.
3. Architect reviews boundaries.
4. Security Engineer performs threat review.
5. Privacy Engineer performs information-flow review.
6. UX/Product Designer reviews interaction.
7. Accessibility Specialist reviews UI.
8. Developer implements.
9. QA builds tests.
10. Performance Engineer checks impact where relevant.
11. Documentation specialist documents behavior.
12. Run test suite.
13. Fix failures.
14. Re-run.
15. Perform regression review.

A feature is not finished until the relevant gate passes.

---

# 118. NO-PLACEHOLDER RULE

Do not leave:

```text
TODO
FIXME
stub
fake implementation
pseudo implementation
not implemented
```

for functionality claimed as complete.

If a capability depends on unavailable external credentials, implement the full integration boundary, provider interface, configuration, mocks/test fixtures, validation, and documentation.

Clearly identify only what requires deployment credentials.

---

# 119. NO FAKE TEST RULE

Do not write tests that merely assert:

```text
true === true
```

Tests must validate observable behavior.

Do not mock the component under test so extensively that no meaningful behavior remains.

---

# 120. NO SILENT ERROR RULE

Never silently swallow unexpected errors.

Use:

- typed domain errors
- structured logging
- user-safe messages
- retry where justified
- dead-letter handling where necessary

---

# 121. FEATURE COMPLETENESS MATRIX

Before finishing, create a matrix containing:

```text
Feature
Implementation status
API
UI
Authorization
Privacy
Tests
Documentation
Observability
```

No core feature may remain undocumented.

---

# 122. PRODUCT REVIEW GATE

Before calling the system complete, re-evaluate it against these competing categories:

```text
Gravatar-like avatar/profile services
generated avatar services
avatar aggregation services
link-in-bio services
professional profile services
federated identity systems
decentralized identity systems
developer identity services
enterprise IAM
digital credential systems
```

Ask:

- Are we merely duplicating an existing capability?
- Is our implementation materially useful?
- Does it preserve the privacy-first architecture?
- Is the UX simpler than the underlying complexity?
- Can developers integrate it easily?
- Can users leave without being trapped?

Correct deficiencies discovered during this review.

---

# 123. IMPLEMENTATION ORDER

Implement in dependency-aware order.

Recommended progression:

```text
Foundation
↓
Authentication
↓
Accounts
↓
Identity Core
↓
Handles/Aliases
↓
Claims
↓
Personas
↓
Privacy/Policies
↓
Profiles
↓
Media/Avatar
↓
Delivery
↓
Organizations/RBAC
↓
Provider Connections
↓
Resolver
↓
Verification
↓
Consent/OAuth
↓
Developer Platform
↓
Contact Relay
↓
QR/Business Card
↓
Analytics
↓
Credentials/DID
↓
OIDC
↓
Import/Export
↓
Self-hosting
↓
Federation
↓
Hardening/Load/Release
```

Dependencies may cause minor changes, but do not implement visually impressive secondary features before the identity/privacy core works.

---

# 124. REQUIRED OUTPUT WHILE IMPLEMENTING

Do not begin by dumping thousands of lines of code without analysis.

First produce:

## A. Requirements confirmation

Translate this prompt into a structured requirement map.

## B. Domain model

Define entities, aggregates, invariants, relationships, and lifecycle.

## C. Architecture

Provide:

- logical architecture
- control plane
- delivery plane
- workers
- persistence
- caching
- media
- event flow
- security boundaries

## D. ADRs

Document major decisions.

## E. Database model

Create schema and indexes.

## F. API design

Define APIs and authentication.

## G. UX architecture

Define navigation, workflows, states, and design system.

## H. Threat model

Identify and mitigate threats.

## I. Implementation plan

Create dependency-aware milestones.

Then implement.

Do not stop after planning.

Continue through the actual production implementation.

---

# 125. REQUIRED FINAL VALIDATION

Before completion, run all possible validation.

The final review must explicitly check:

```text
architecture
domain boundaries
security
privacy
authentication
authorization
identity resolution
verification
claims
personas
avatars
media
organizations
consent
OAuth/OIDC
APIs
webhooks
SDKs
WordPress compatibility
accessibility
internationalization
SEO
Docker deployment
backups
observability
performance
tests
documentation
```

Search for:

```text
TODO
FIXME
HACK
placeholder
mock-only production behavior
hard-coded secret
debug configuration
console logging that should not ship
unsafe CORS
development credential
```

Correct all relevant findings.

---

# 126. TEST-FAILURE POLICY

Whenever any test fails:

1. Do not disable the test merely to obtain green CI.
2. Investigate the root cause.
3. Determine whether implementation or test expectation is incorrect.
4. Correct the underlying issue.
5. Re-run the affected suite.
6. Run regression tests.
7. Continue until green.

---

# 127. SECURITY-FAILURE POLICY

If a security review reveals a significant flaw:

1. Stop work on dependent functionality.
2. Determine root cause.
3. Fix the architectural or implementation defect.
4. Add regression tests.
5. Update threat model.
6. Re-run security validation.

Do not defer critical vulnerabilities to a hypothetical future release.

---

# 128. PERFORMANCE-FAILURE POLICY

If a performance budget is exceeded:

1. Measure.
2. Profile.
3. Identify bottleneck.
4. Optimize the actual bottleneck.
5. Re-test.
6. Record results.

Do not add caching randomly without understanding invalidation and privacy implications.

---

# 129. DEFINITION OF DONE

The project is complete only when:

- it builds successfully
- Docker deployment works
- migrations work
- core user journeys work end-to-end
- security controls are implemented
- privacy policy enforcement is tested
- tests pass
- accessibility requirements are satisfied
- API documentation exists
- developer integration examples work
- backup and restoration are documented and tested
- monitoring exists
- no known critical or high-severity security defects remain
- no claimed feature is merely a placeholder
- documentation reflects actual implementation

---

# 130. EXPECTED USER JOURNEYS

At minimum validate these journeys end-to-end.

### New individual user

```text
Register
→ verify account
→ create identity
→ choose handle
→ create avatar
→ build profile
→ create professional persona
→ configure privacy
→ publish profile
```

### Developer

```text
Register
→ create application
→ obtain credentials
→ use SDK/API
→ retrieve consented identity
→ receive webhook
```

### Gravatar-style adoption

```text
Developer changes integration
→ avatar endpoint resolves
→ fallback works
→ caching works
```

### External provider connection

```text
Connect GitHub
→ verify account
→ import selected information
→ configure sync
→ provenance visible
```

### Organization

```text
Create organization
→ verify domain
→ invite member
→ issue employment claim
→ employee accepts/uses professional persona
```

### Privacy

```text
User marks field private
→ public HTML hides it
→ JSON hides it
→ API hides it
→ search index excludes it
→ machine-readable profile excludes it
→ cache does not leak it
```

### Consent

```text
App requests profile scope
→ user selects persona
→ user approves fields
→ app receives only authorized fields
→ user revokes
→ access immediately stops
```

### Account merge

```text
User proves ownership of two accounts
→ previews consequences
→ merges safely
→ URLs continue resolving
→ audit history preserved
```

### Export

```text
User requests export
→ background job creates bundle
→ secure download
→ machine-readable manifest
```

### Self-hosting

```text
Operator configures environment
→ docker compose up
→ migrations execute
→ health checks pass
→ user registration works
→ avatars serve correctly
```

---

# 131. FINAL ENGINEERING PHILOSOPHY

Throughout the work, optimize simultaneously for:

```text
Security
Privacy
Correctness
Maintainability
Developer Experience
User Experience
Accessibility
Performance
Interoperability
Portability
Operational Reliability
```

Do not maximize feature count at the expense of architectural coherence.

When two requirements conflict:

1. protect security and privacy
2. preserve data correctness
3. preserve user agency
4. maintain interoperability
5. optimize UX
6. optimize implementation convenience last

The platform should remain understandable to a competent engineering team years after the first release.

---

# 132. FINAL MANDATE

Your responsibility is not to generate an impressive scaffold.

Your responsibility is to **design, implement, test, harden, document, and validate the complete product**.

At every stage ask:

```text
Is this actually implemented?
Is it secure?
Is it privacy-safe?
Is it correctly authorized?
Is it maintainable?
Is it observable?
Is it documented?
Is it tested?
Would a real user understand it?
Would a real developer trust this API?
Could this safely run in production?
```

If the answer to any relevant question is no:

**correct the problem before treating that part of the system as complete.**

Continue until the repository represents a coherent, production-ready universal identity and profile infrastructure platform rather than a prototype.