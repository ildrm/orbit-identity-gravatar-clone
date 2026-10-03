ALTER TABLE domains ADD COLUMN custom_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE domains ADD COLUMN canonical boolean NOT NULL DEFAULT false;
ALTER TABLE domains ADD COLUMN routing_state text NOT NULL DEFAULT 'DISABLED' CHECK(routing_state IN ('DISABLED','ACTIVE','DNS_ERROR','PROOF_ERROR'));
CREATE UNIQUE INDEX canonical_domain ON domains(identity_id) WHERE canonical AND custom_enabled AND revoked_at IS NULL;
