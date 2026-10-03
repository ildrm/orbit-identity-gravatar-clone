# Disclosure and data ownership

An account authenticates; an identity is an immutable subject; memberships delegate actions. A public profile is a projection, not the owner record. Persona/locale authority ranks before disclosure in SQL, with another typed policy check before serialization. A private persona override cannot reveal a public base claim.

Search selects opted-in public identity/claim values before matching. Private/unlisted identities remain excluded. Public HTML, RSC, API, machine, agent and search channels have separate rules. Personalized HTML uses the current session; SEO metadata independently uses an anonymous projection and session-bearing pages are noindex. Robots signals do not prevent a recipient from copying disclosed information.

Connections require mutually confirmed, unexpired relationships with current active owned identities. Organization audiences require current explicit membership or confirmed organization affiliation. Unilateral, inactive, expired and revoked relationships confer no disclosure.

Consent intersects current holder ownership, identity/field policy, application, persona, scopes, fields and expiry. PRIVATE fields stay private. OAuth account email requires both email.read and explicit account:email selection; it is never implicit. Selected credentials require credentials.read plus exact credential IDs. Native grants do not implicitly expose account email. Revocation stops new reads and queued webhook delivery; already downloaded data cannot be recalled.

Public avatar/media delivery checks publication. Separate bearer-authenticated native/OAuth avatar endpoints require current identity.read and avatar.read, current owner, active identity/persona, token and grant. They return private bytes with no-store and Vary: Authorization; tokens never appear in URLs. Consent is checked again after storage reads. Logs record the operation and correlation ID, never image bytes or token contents.

Uploads and exports remain private. Raster validation/re-encoding removes metadata and active input; sources and derivatives use immutable object IDs. Public uploaded bytes use no-store to preserve origin revocation. Generated artwork contains no private name/claim/photo values and permits short public caching. Minimal delivery projections use generation/writer fences and temporal expiry; warm hits avoid SQL, while writes/crashes/reconnects prevent stale authorization. Operator SQL changes require maintenance reconciliation.

Enterprise issuer assertions and recipient projections are separate. Acceptance starts private; publication is deliberate. Issuer revocation/expiry invalidates credentials and projected claims. Federation exports public opted-in projections only to approved pinned peers; updates/deletions have replay, audience, sequence and expiry checks. Blocking purges remote records. Custom-domain authority expires/revalidates and cannot bypass current profile visibility.

Merge preserves IDs, history and provenance while importing content privately and revoking source authentication/grants. Reviewed imports cannot inherit publication, provider/issuer verification, ownership or third-party consent. Exports include owner data and validated media/checksums; downloads expire.

Contact is disabled by default. Senders explicitly share their reply address; recipient email is hidden. Owner inbox, blocking and quotas apply. Opt-in analytics stores daily aggregates, respects DNT/GPC and does not create visitor identities.

Deletion tombstones resolution immediately, revokes sharing/grants, removes claims/revisions/contact contents, scrubs account/provider secrets as applicable and queues object cleanup. Jobs recheck terminal states. Historical handles remain reserved. Digital legacy requires accepted custodians, encrypted evidence, waiting period, independent review and owner veto; erasure is terminal.

## Default retention

| Data                                                     | Runtime rule                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Challenges/OAuth requests                                | Remove one day after expiry.                                                    |
| Expired OAuth codes/tokens and revoked/expired sessions  | Remove after 30 days.                                                           |
| Completed jobs                                           | Remove after seven days; delivered email/relay payloads scrub after one day.    |
| Dead jobs and application access logs                    | Remove after 30 days.                                                           |
| Contact messages, notifications and analytics aggregates | 90 days.                                                                        |
| Closed reports/decided appeals                           | Evidence text scrub after 90 days.                                              |
| Revisions and audit records                              | One year.                                                                       |
| Export objects                                           | Expire after 24 hours; issued download URL lasts one minute.                    |
| Abandoned uploads                                        | Reject/delete quarantine after one day.                                         |
| Terminal legacy evidence                                 | Erased on terminal decisions/application, with scheduled cleanup as a backstop. |
| Federation receipts/cache                                | Bounded protocol expiry; signed deletion/blocking purge projections.            |

The scheduler implements these rules. Open cases and enduring identity/provenance records retain only their necessary authoritative state. Offsite backup retention and applicable operator obligations require deployment policy; restored old states must be reconciled with current deletion/revocation history.

Recoverable TOTP/provider/webhook/email-token/DID/legacy secrets use authenticated encryption with an identified key ring. Passwords, sessions, challenges and client credentials use hashes/digests. Key rotation keeps explicitly configured prior keys for graceful re-encryption, then retires them after validation. Store keys separately from backups. No legal compliance certification is asserted.
