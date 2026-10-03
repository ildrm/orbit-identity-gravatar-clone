ALTER TABLE identities ADD COLUMN did_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE signing_keys (
 id text PRIMARY KEY,identity_id text REFERENCES identities(id),public_jwk jsonb NOT NULL,private_encrypted text NOT NULL,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','RETIRED','REVOKED')),
 created_at timestamptz NOT NULL DEFAULT now(),retired_at timestamptz,revoked_at timestamptz
);
CREATE UNIQUE INDEX current_identity_key ON signing_keys(COALESCE(identity_id,'')) WHERE state='ACTIVE';
CREATE TABLE did_associations (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),did text NOT NULL,
 key_id text NOT NULL,proof text NOT NULL,document_digest text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,UNIQUE(identity_id,did)
);
CREATE TABLE credentials (
 id text PRIMARY KEY,issuer_id text NOT NULL REFERENCES identities(id),subject_id text NOT NULL REFERENCES identities(id),
 assertion_id text REFERENCES enterprise_assertions(id),key_id text NOT NULL REFERENCES signing_keys(id),
 token_encrypted text NOT NULL,token_digest text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_subject ON credentials(subject_id,created_at DESC);
