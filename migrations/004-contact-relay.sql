ALTER TABLE identities ADD COLUMN contact_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE contact_messages (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),sender_id text NOT NULL REFERENCES accounts(id),
 subject text NOT NULL,body text NOT NULL,sender_email_consent boolean NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_inbox ON contact_messages(identity_id,created_at DESC);
CREATE TABLE contact_blocks(identity_id text NOT NULL REFERENCES identities(id),account_id text NOT NULL REFERENCES accounts(id),PRIMARY KEY(identity_id,account_id));
