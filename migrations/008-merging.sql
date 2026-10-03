ALTER TABLE accounts ADD COLUMN merged_into text REFERENCES accounts(id);
ALTER TABLE accounts DROP CONSTRAINT accounts_state_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_state_check CHECK(state IN ('ACTIVE','LOCKED','MERGED','DELETED'));
CREATE TABLE identity_merges (
 id text PRIMARY KEY,source_id text NOT NULL UNIQUE REFERENCES identities(id),target_id text NOT NULL REFERENCES identities(id),
 actor_id text NOT NULL REFERENCES accounts(id),source_snapshot jsonb NOT NULL,target_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(source_id<>target_id)
);
CREATE TABLE merge_persona_aliases (
 source_id text NOT NULL REFERENCES identities(id),slug text NOT NULL,target_persona_id text NOT NULL REFERENCES personas(id),
 PRIMARY KEY(source_id,slug)
);
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f' AND confrelid IN ('personas'::regclass,'media'::regclass)
 LOOP EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',c.tbl,c.conname);END LOOP;
END $$;
