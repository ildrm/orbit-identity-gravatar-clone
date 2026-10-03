# Security

Review the threat model, privacy document, protocol contracts and release report before deployment. Local release verification records the exercised controls and image scans. It does not confer standards or compliance certification.

Report a vulnerability privately to the repository owner through an available private channel. No dedicated reporting address has been configured; do not post credentials, private profiles or exploit data in a public issue.

Include the affected version, endpoint/action, expected permission, actual result and sanitized request ID. Keep secrets and user data out of the report. Reproduce in an isolated instance where possible.

Behavioral checks cover current account/session/membership authority, private disclosure channels, CSRF, bounded DNS-pinned outbound transport, quarantined media, OAuth/native consent and avatar revocation, MFA replay, enterprise assertions, proved merge, signed federation/migration, terminal deletion, encrypted database/object restore and dependency outages. The release report records the actual results and bounded protocol subsets.

Keep dependency and image scans current, protect retained encryption keys, and route alerts to the deployment operator. Public infrastructure verification, independent review and capacity testing must use the deployed environment and its actual operating targets.
