# Contributing

Preserve GPL-2.0 and follow repository instructions. Treat the original specification and feature matrix as the source of product scope. Use strict TypeScript, registered claim schemas, parameterized SQL and current authorization inside transactional mutations.

Add forward SQL migrations; never rewrite an applied migration. Keep actor audit/outbox writes in the same transaction. Protect manual claim authority, persona overrides and every disclosure channel. Do not add a protocol-shaped placeholder or advertise custom tokens as OAuth/OIDC.

Use real user-visible workflows and truthful errors. Test behavior and denied access, including private HTML/RSC/JSON/search/media leakage and asynchronous revocation/deletion. Run the documented checks appropriate to the change. Do not disable failing gates.

Keep secrets, dependency/build output, runtime storage and screenshots out of commits. Python/PHP/WordPress changes need their language checks and integration evidence. Update the API/user/operator docs and the requirement ledger alongside implementation.

A green CI run verifies its declared checks; it does not certify unfinished product features or a production deployment. Release approval remains gated by the full ledger and production evidence.
