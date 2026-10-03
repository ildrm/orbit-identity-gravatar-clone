ALTER TABLE provider_connections ADD COLUMN actor_id text REFERENCES accounts(id);
CREATE UNIQUE INDEX pending_provider_sync ON jobs((payload->>'connectionId')) WHERE kind='provider-sync' AND status IN ('PENDING','RUNNING');
