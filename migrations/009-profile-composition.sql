ALTER TABLE identities ADD COLUMN analytics_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE profile_blocks (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),persona_id text,
 kind text NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 1000),
 enabled boolean NOT NULL DEFAULT false,locale text NOT NULL DEFAULT 'en',title text NOT NULL,
 configuration jsonb NOT NULL,policy jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(persona_id,identity_id) REFERENCES personas(id,identity_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX profile_blocks_identity ON profile_blocks(identity_id,position,id);
CREATE TABLE web_proofs (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),url text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','FAILED','REVOKED')),
 verified_at timestamptz,last_checked_at timestamptz,expires_at timestamptz,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(identity_id,url)
);
CREATE INDEX web_proofs_revalidation ON web_proofs(last_checked_at) WHERE status='VERIFIED' AND revoked_at IS NULL;
