ALTER TABLE exports ADD COLUMN archive_key text;
CREATE TABLE imports(id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),account_id text NOT NULL REFERENCES accounts(id),source text NOT NULL,imported_claims integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
