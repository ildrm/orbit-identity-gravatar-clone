CREATE TABLE enterprise_assertions (
 id text PRIMARY KEY,issuer_id text NOT NULL REFERENCES identities(id),subject_id text NOT NULL REFERENCES identities(id),
 key text NOT NULL,value jsonb NOT NULL,locale text NOT NULL DEFAULT 'en',
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','DISPUTED','REVOKED','EXPIRED')),
 actor_id text NOT NULL REFERENCES accounts(id),accepted_by text REFERENCES accounts(id),accepted_at timestamptz,
 dispute_reason text,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(issuer_id<>subject_id)
);
CREATE INDEX assertions_subject ON enterprise_assertions(subject_id,created_at DESC);
CREATE INDEX assertions_issuer ON enterprise_assertions(issuer_id,created_at DESC);
ALTER TABLE claims ADD COLUMN assertion_id text REFERENCES enterprise_assertions(id);
CREATE UNIQUE INDEX assertion_claim ON claims(assertion_id) WHERE assertion_id IS NOT NULL;
