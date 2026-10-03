# User guide

Register with an email and a password of at least 12 characters. Verify the delivered link before signing in. The local instance uses Mailpit. Production mail uses the operator's SMTP configuration.

Create an identity with a handle and display name. It starts private. The immutable ID survives handle changes; historical handles remain reserved. Handles are ASCII, while display/native/transliterated names and content support Unicode. The rename cooldown is 30 days.

## Profiles, personas and publication

Save fields deliberately in Profile. Every value carries source, freshness, audience, channel controls and a disclosure transformation. A manually entered value is a user assertion. Use source selection to resolve conflicts without deleting provenance.

Personas give professional/personal contexts. A persona field overrides its base field; a private override suppresses public fallback. Provider imports remain private and do not silently replace manual authority.

Privacy separates visibility, public discovery, search-engine indexing, machine and agent access. Unlisted means anyone with the address can view permitted content. A private field stays private when the identity becomes public.

Profile blocks have structured text, links and media selections. Save each block, then enable and publish it deliberately. Drag blocks or use Move up/Move down. Saved audience previews show PUBLIC, SEARCH, current APPLICATION grant or management projection, with phone/tablet widths. Previews show saved content; refresh after changes.

## Avatars and media

Upload PNG/JPEG/WebP/AVIF with a useful description. Size/pixel/decode validation and re-encoding remove metadata and generate responsive formats. Activate only READY media. Crop, rotate, choose focal point, remove a chosen background color and select quality through immutable edits. Header, gallery, project and branding assets use the same private processing boundary.

Choose a default/persona avatar or schedule a temporary application/domain override. Cancelling or reaching the end restores current selection without waiting for a scheduler. Publication is separate from storage. Revoked/private media stops being delivered at origin. Generated geometric/rings/initials artwork provides a configurable fallback.

## Applications, consent and trust

Applications supports native clients and OAuth public/confidential clients. Register exact callback URLs. Native credentials and OAuth tokens have separate protocols. Secrets appear only once; store them privately.

Approve a persona, fields, scopes, purpose and expiry. The application receives the intersection with current field policy. PRIVATE never becomes shared merely through consent. Review receipts and last access, then revoke to stop subsequent reads and queued webhook disclosures.

Developer controls show usage, metadata-only access logs, signed webhook deliveries, test/replay, secret rotation and enable/disable. Receivers must deduplicate delivery IDs. OIDC and GraphQL are disabled.

Credentials and DID controls support organization-issued assertions, private signed credentials, public status and key rotation/revocation. Grant selected credentials explicitly to an application; credentials do not make an entire person universally verified.

## Organizations and external connections

People & roles invites a verified account to a specific identity role. Managing an organization does not transfer ownership of an employee's personal identity. Organizations issue employment, membership, certification, education and project-role assertions. Recipients accept privately, choose a persona and publish separately; they can dispute or remove their projection. The issuer retains revocation authority.

Connections supports configured GitHub OAuth, selected private import, manual/scheduled sync, source preference, errors and disconnect. Revoke provider authorization at GitHub as well when appropriate. Other supported imports use a versioned validated bundle; no unauthorized scraping occurs.

Verification supports DNS TXT, well-known, reciprocal rel=me and metadata proofs. Custom domains require current ownership and routing proof before serving a profile or obtaining a certificate. Removing or losing proof removes routing authority. Production DNS and certificates require the operator's real host configuration.

Relationships are requests to public handles/IDs. The recipient confirms, and either endpoint can revoke. Only current mutually confirmed connections or current organization memberships grant contextual audiences.

## Security, portability and account lifecycle

Security supports passkeys, authenticator setup, backup-code rotation/disable and session review. Sensitive changes require recent password/MFA proof. Backup codes are single-use. Recovery revokes sessions and still requires configured MFA or an unused backup code.

Account settings changes locale, IANA timezone, password and verified email. Email changes require a code delivered to the new address; the old address remains authoritative until confirmation. Password changes revoke sessions. Account deletion requires explicit confirmation and handles owned identities deliberately.

Export & sharing creates versioned JSON and tar.gz archives with a manifest, checksums, private owner records, validated source images and all responsive derivatives. Export requests expire after 24 hours; download URLs last one minute. Import validation starts a reviewed private projection and cannot inherit issuer verification, publication, consent or ownership.

History compares actual revisions and restores content privately, including deleted blocks with new IDs. Merge requires proof of both identities/accounts, a consequence preview and confirmation. Source handles redirect while history/provenance survive; source authentication and grants are revoked appropriately.

Digital legacy nominations confer no present editing rights. A custodian must accept. Claims require encrypted evidence, a 30-day waiting period and independent moderator decisions; the owner can veto. Supported outcomes have explicit lifecycle effects, and erasure is terminal.

Notifications are account-bound and configurable. Analytics is opt-in aggregate counting and respects DNT/GPC; it does not record visitor identities. Contact relay is opt-in, requires verified senders and explicit sender address sharing, hides the recipient address and supports blocks. Moderation reports and appeals follow independent review boundaries.

Identity deletion tombstones public resolution immediately, revokes disclosure/sharing and queues private object cleanup. Historical handles remain reserved. Previously downloaded public information cannot be recalled.
