ALTER TABLE identities DROP CONSTRAINT identities_state_check;
ALTER TABLE identities ADD CONSTRAINT identities_state_check CHECK(state IN ('ACTIVE','RESTRICTED','LOCKED','SUSPENDED','MERGED','MEMORIALIZED','DELETED','FROZEN','ARCHIVED','TRANSFERRED'));
ALTER TABLE identities ADD COLUMN migrated_to text;
ALTER TABLE identities ADD COLUMN migrated_at timestamptz;
ALTER TABLE identities ADD COLUMN migration_proof text;
