ALTER TABLE media ADD COLUMN transforms jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(transforms)='object');
CREATE TABLE avatar_selections (
 id text PRIMARY KEY,
 identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
 media_id text NOT NULL,
 persona_id text REFERENCES personas(id) ON DELETE CASCADE,
 context text NOT NULL CHECK(context IN ('DEFAULT','APPLICATION','DOMAIN')),
 application_id text REFERENCES applications(id) ON DELETE CASCADE,
 domain_id text REFERENCES domains(id) ON DELETE CASCADE,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz,
 created_by text NOT NULL REFERENCES accounts(id),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(media_id,identity_id) REFERENCES media(id,identity_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(ends_at IS NULL OR ends_at>starts_at),
 CHECK((context='DEFAULT' AND application_id IS NULL AND domain_id IS NULL) OR (context='APPLICATION' AND application_id IS NOT NULL AND domain_id IS NULL) OR (context='DOMAIN' AND application_id IS NULL AND domain_id IS NOT NULL))
);
CREATE INDEX avatar_selection_current ON avatar_selections(identity_id,starts_at,ends_at) WHERE revoked_at IS NULL;
