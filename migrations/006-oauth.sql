ALTER TABLE applications ADD COLUMN oauth_mode text CHECK(oauth_mode IN ('PUBLIC','CONFIDENTIAL'));
ALTER TABLE applications ADD COLUMN oauth_secret_digest text;
ALTER TABLE consents ADD COLUMN account_id text REFERENCES accounts(id);
ALTER TABLE consents ADD COLUMN purpose text NOT NULL DEFAULT '';
ALTER TABLE consents ADD COLUMN protocol text NOT NULL DEFAULT 'NATIVE' CHECK(protocol IN ('NATIVE','OAUTH'));
CREATE TABLE oauth_requests (
 id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id),application_id text NOT NULL REFERENCES applications(id),
 redirect_uri text NOT NULL,state text NOT NULL,challenge text NOT NULL,scopes jsonb NOT NULL,fields jsonb NOT NULL,
 expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_codes (
 digest text PRIMARY KEY,application_id text NOT NULL REFERENCES applications(id),consent_id text NOT NULL REFERENCES consents(id),
 redirect_uri text NOT NULL,challenge text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz
);
CREATE TABLE oauth_tokens (
 digest text PRIMARY KEY,consent_id text NOT NULL REFERENCES consents(id),kind text NOT NULL CHECK(kind IN ('ACCESS','REFRESH')),
 scopes jsonb NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_consent ON oauth_tokens(consent_id);
CREATE INDEX oauth_requests_expiry ON oauth_requests(expires_at);
