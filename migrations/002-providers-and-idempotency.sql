CREATE TABLE provider_connections (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),provider text NOT NULL,
 provider_id text NOT NULL,username text NOT NULL,token_encrypted text NOT NULL,
 fields jsonb NOT NULL,mode text NOT NULL DEFAULT 'ONE_TIME',last_synced_at timestamptz,
 last_error text,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(identity_id,provider)
);
CREATE INDEX provider_sync ON provider_connections(last_synced_at) WHERE revoked_at IS NULL AND mode='SYNC';
CREATE UNIQUE INDEX webhook_event_job ON jobs((payload->>'webhookId'),(payload->'event'->>'id')) WHERE kind='webhook';
ALTER TABLE accounts ADD COLUMN totp_last_step bigint;
