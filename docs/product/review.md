# Product review

Orbit supplies a permanent identity independent of handles, persona/claim authority, separate disclosure channels, granular consent and revocable avatar delivery. Registration starts private. Specific proofs never turn an entire person into a universally verified identity.

| Category from the source     | Useful implemented behavior                                                                                                             | Documented boundary                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Avatar/profile services      | Original generated art, immutable image edits, responsive formats, schedules and current publication                                    | Gravatar compatibility is a documented subset; public CDN capacity needs deployment measurement.                 |
| Generated/avatar aggregation | Self-hosted styles, configured fallback, connected GitHub import and approved resolver adapters                                         | Potential additional providers are extension points, without uncontrolled scraping or arbitrary URL fetches.     |
| Link-in-bio/professional     | Structured reorderable blocks, localized claims/personas, vCard/QR, enterprise assertions                                               | Publication and recipient acceptance remain deliberate and separate.                                             |
| Federation/decentralized     | Pinned signed Orbit federation v1, migration, DID association/key lifecycle and private VC/status                                       | Custom protocol and JOSE/DID subset are documented; universal cross-vendor certification is not claimed.         |
| Developer identity           | OAuth PKCE/native grants, packaged SDKs/UI/CLI, scoped private avatars, actual signed webhook retries and WordPress runtime integration | No unrestricted account-write API; OIDC and GraphQL are disabled.                                                |
| Enterprise IAM/credentials   | Delegated identity roles, separate issuer/recipient authority, credential verification/status/revocation                                | This is an identity/profile product; it does not advertise enterprise SAML/SCIM or universal human verification. |
| Portability/self-hosting     | Checked JSON/media bundles, private import/revision restore, proved merge, encrypted full restore and Docker operation                  | Operator credentials, DNS/SMTP/offsite/registry inputs remain deployment configuration.                          |

The product lets users leave with claims, personas, validated media and provenance. Import cannot inherit publication or verification authority. Revocation/deletion govern subsequent origin reads and queued side effects; already downloaded public data cannot be recalled.

The UI uses deliberate saves, current audience previews, structured controls, keyboard ordering, mobile layouts and locale-aware direction/dates. Browser regressions include privacy, passkeys, accessibility semantics and responsive checks. These role perspectives are applied by the implementer; they are not an independent usability study or certification.

See the requirement matrix and release report for exact behavior, executed evidence and operational limits.
