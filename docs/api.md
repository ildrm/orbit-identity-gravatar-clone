# API and integration contracts

The REST control plane is versioned under /api/v1. The live /api/v1/openapi.json route documents exact methods, shared strict request schemas, claim value alternatives, authentication, public output models and standard errors. Request contracts are generated from the same Zod schemas used at runtime. Core public/consented profiles, search, resolver and OAuth responses have explicit output contracts; auxiliary manager records retain their documented bounded database projections.

## Principals and authentication

Browser management requires a verified active account and a revocable HttpOnly identity_session cookie. Mutations require the configured public/admin Origin; cookies use SameSite=Lax and Secure in production. JSON bodies are bounded to 64 KiB. Internal service APIs require the internal key and are blocked at the public proxy.

Native ik_ application credentials authenticate GET /application for application metadata. Native ic_ grants authenticate /application/profile and /application/credentials. OAuth oa_ access tokens use /oauth/profile and /oauth/credentials. An application credential grants no account-management rights. OIDC is disabled.

OAuth authorization code supports exact registered HTTPS callbacks, S256 PKCE for both public/confidential clients, single-use consent requests/codes, state/issuer return, 15-minute access tokens, rotating refresh families and revocation. Token/revocation endpoints accept strict single-valued form bodies; confidential clients use HTTP Basic. Native and OAuth credentials remain distinct. See [protocol details](protocols.md).

Secrets are returned once at creation/rotation. Application revocation invalidates grants and stops webhook disclosure. Native application-key rotation alone does not replace separately issued consent tokens. Every grant checks current holder ownership, application state, expiry, selected persona, scopes, fields and field policy.

## Route families

| Route family                                                         | Behavior and authority                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /auth/* and /account/*                                               | Verified signup, login/recovery, sessions, step-up, WebAuthn, TOTP, backup rotation/disable, password/email changes, locale/timezone and confirmed account deletion. |
| /identities, /identities/:id                                         | New private identity and authorized management projection; action permissions differ by role.                                                                        |
| /identities/:id/claims, /claims/:claim/select, /personas             | Typed claims, conflicts/source preference, localized content and persona overrides.                                                                                  |
| /identities/:id/settings, /handle                                    | Visibility, discovery, machine/agent policy, themes, lifecycle and reserved historical handles.                                                                      |
| /identities/:id/blocks, /block-order, /preview, /preview-grants      | Structured composition, exact-set atomic ordering and saved audience previews; previews recheck current grants.                                                      |
| /profiles/:identifier, /search, /resolve                             | Current permitted public projections, bounded keyset search and approved native/domain/own-email/GitHub/DID adapters.                                                |
| /identities/:id/media, /avatar-selections                            | Signed quarantined upload, immutable crop/rotation/focal/color edits, publication, activation and scheduled/default/persona/app/domain overrides.                    |
| /identities/:id/members, /invitations, /relationships                | Verified-email-bound delegation and confirmed/revocable graph edges.                                                                                                 |
| /organizations/:id/assertions and /identities/:id/assertions/*       | Issuer-controlled enterprise assertions and recipient acceptance/publication/dispute; issuer revocation is independent.                                              |
| /identities/:id/domains and /custom-domains/*                        | DNS TXT/well-known proof, custom routing, current ownership/expiry and removal.                                                                                      |
| /identities/:id/connections/* and /web-proofs                        | GitHub import/sync, reciprocal rel=me/well-known/meta proof, bounded verification and revalidation.                                                                  |
| /applications, /identities/:id/consents, /oauth/*                    | Native/OAuth clients, granular receipts, selected VC access, rotation and revocation.                                                                                |
| /applications/:id/usage, /logs, /deliveries, /webhooks               | Developer metadata, signed delivery diagnostics, replay, test, enable/disable and secret rotation.                                                                   |
| /credentials/_, /dids/_, /identities/:id/did/*                       | Private credential issuance/download/verification/status and signed DID association/key lifecycle.                                                                   |
| /federation/* and /identities/:id/migrations                         | Approved pinned peers, signed inbox/resolution and source/destination migration proofs.                                                                              |
| /identities/:id/exports, /exports/:id/download, /imports, /revisions | Async JSON and tar.gz media bundles, checksums, private reviewed import, comparison and private restore.                                                             |
| /identities/:id/legacy, /legacy/*                                    | Custodian acceptance, encrypted evidence, waiting period, independent decisions and owner veto.                                                                      |
| /contact/:id, /identities/:id/contact                                | Opt-in verified-sender relay, hidden recipient, inbox and blocking.                                                                                                  |
| /identities/:id/qr, /q/:id                                           | Revocable/expiring profile destinations under current privacy.                                                                                                       |
| /notifications, /notification-settings, /schemas                     | Account-bound notifications and bounded declarative schema extensions.                                                                                               |
| /admin/*                                                             | Explicit moderator authority, reports, restrictions, independent appeals and peer moderation.                                                                        |

Use the live route document for exact paths and bodies; the table describes families. These management routes do not form an unrestricted third-party write API.

## Projection and schemas

Claims register types, provenance, freshness and policies. Extension schemas are versioned bounded declarative data, without executable code. Search/index eligibility is separate from PUBLIC/UNLISTED/PRIVATE. Channel gates cover API, machine, agents and index. Transformations are FULL, GENERALIZED, ALIAS, REDACTED and HIDDEN; an explicit safe replacement is required for aliases/generalization. A private persona override suppresses base fallback.

Grant disclosure is the intersection of identity/field policy, application selection, current persona, scopes, selected fields and expiry. PRIVATE is never overridden by consent. Use SPECIFIC_APPLICATIONS for chosen clients. Avatar access requires avatar.read. Profiles return bearer-authenticated /api/v1/application/avatar or /api/v1/oauth/avatar URLs; clients fetch them with Authorization and never put tokens in URLs. Credentials require explicit credentials.read and selected credential:vcr_* fields. OAuth email.read requires explicit account:email selection as well as the scope. Native email disclosure and full graph release are not implicit.

PUBLIC/SEARCH/APPLICATION/OWNER previews use current policy without adding consumer access-log events. APPLICATION requires a current holder-owned grant and uses that grant's persona.

## Delivery and compatibility

Avatar requests use the public edge path /avatar/:identifier?size=128&default=geometric&format=webp. The documented subset accepts native ID/handle, size/s (16–1024), rating, geometric/rings/initials/404 fallback and SVG/PNG/JPEG/WebP/AVIF. External URL fallback and public email-hash enumeration are disabled; full Gravatar compatibility is not claimed.

Processed media generates widths 64/128/256/512/1024 in WebP, JPEG, PNG and AVIF. Immutable object IDs prevent an edit from changing historical bytes. Origin /assets/:mediaId/128.webp checks current publication and is no-store; revocation takes precedence over CDN persistence. Nonpersonal deterministic generated images support ETag, conditional 304, max-age and stale-while-revalidate. Minimal Redis projections avoid a database lookup on every warm hit; writer fencing and temporal expiry prevent stale authorization.

## Quotas, errors and provider transport

API errors contain code, message, status and request_id; preserve the ID for support. OAuth token endpoints use OAuth error/error_description. Protected resources conceal existence through 404. Unexpected SQL messages, request bodies and credentials are never logged.

Defaults: authentication 20/IP/5 minutes; general API 300/IP/minute; delivery 300/IP/minute plus edge pacing; resolver 30/principal/minute; upload 20/account/hour; webhook test 10/account/hour; replay 20/account/hour; contact 5/sender/recipient/day. Active applications are bounded per account. Redis outage fails closed.

GitHub requests have token-bound quotas, one bounded GET retry, encrypted 120-second cache, a 30-second circuit after repeated transport failures, pinned public DNS and strict response/deadline limits. Reconnect revoked provider credentials deliberately.

## Webhook receiver contract

Verify HMAC-SHA256 over timestamp + "." + exact raw JSON body using the current signing secret. Require a timestamp within five minutes and compare in constant time. Headers: X-Identity-Timestamp, X-Identity-Signature, X-Identity-Delivery. Payload contains event id/type, identityId when relevant, and occurredAt; it does not embed private claims.

Delivery is at-least-once. Deduplicate delivery/event IDs before applying business effects. Retries use exponential backoff and retain the ID; explicit developer replay also retains it. Current consent, owner, application and endpoint state are checked before send. Failed jobs become dead letters after five attempts. Rotating a hook secret changes subsequent and pending signatures.
