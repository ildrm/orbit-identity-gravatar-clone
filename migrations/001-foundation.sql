CREATE TABLE accounts (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 verified_at timestamptz, locale text NOT NULL DEFAULT 'en', timezone text NOT NULL DEFAULT 'UTC',
 state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','LOCKED','DELETED')),
 totp_secret text, totp_enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE challenges (
 id text PRIMARY KEY, account_id text REFERENCES accounts(id) ON DELETE CASCADE,
 kind text NOT NULL, digest text NOT NULL UNIQUE, data jsonb NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX challenges_account ON challenges(account_id,kind);
CREATE TABLE sessions (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 digest text NOT NULL UNIQUE, device text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE TABLE passkeys (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 public_key bytea NOT NULL, counter bigint NOT NULL, transports jsonb NOT NULL,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE backup_codes(account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,digest text NOT NULL UNIQUE,used_at timestamptz,PRIMARY KEY(account_id,digest));
CREATE TABLE identities (
 id text PRIMARY KEY, type text NOT NULL, handle text NOT NULL UNIQUE,
 visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PUBLIC','UNLISTED','PRIVATE')),
 state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RESTRICTED','LOCKED','SUSPENDED','MERGED','MEMORIALIZED','DELETED')),
 merged_into text REFERENCES identities(id), searchable boolean NOT NULL DEFAULT false,
 indexable boolean NOT NULL DEFAULT false, machine boolean NOT NULL DEFAULT false, agent boolean NOT NULL DEFAULT false,
 theme text NOT NULL DEFAULT 'light',locale text NOT NULL DEFAULT 'en',
 avatar_media_id text,avatar_style text NOT NULL DEFAULT 'geometric',avatar_color text NOT NULL DEFAULT '#5755d9',
 revision integer NOT NULL DEFAULT 1, renamed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(handle ~ '^[a-z][a-z0-9_]{2,29}$'),
 CHECK(type IN ('PERSON','ORGANIZATION','TEAM','PROJECT','APPLICATION','SERVICE','BOT','BRAND','COMMUNITY'))
);
CREATE TABLE handles (
 handle text PRIMARY KEY, identity_id text NOT NULL REFERENCES identities(id),
 primary_handle boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(handle ~ '^[a-z][a-z0-9_]{2,29}$')
);
CREATE UNIQUE INDEX one_primary_handle ON handles(identity_id) WHERE primary_handle;
CREATE TABLE memberships (
 identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
 account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('OWNER','ADMIN','EDITOR','PROFILE_MANAGER','BRAND_MANAGER','HR_MANAGER','DEVELOPER','AUDITOR')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(identity_id,account_id)
);
CREATE INDEX membership_account ON memberships(account_id);
CREATE TABLE personas (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
 name text NOT NULL,slug text NOT NULL,active boolean NOT NULL DEFAULT true,
 avatar_media_id text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(identity_id,slug),UNIQUE(id,identity_id)
);
CREATE TABLE claims (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
 key text NOT NULL,value jsonb NOT NULL,persona_id text,
 locale text NOT NULL DEFAULT 'en',policy jsonb NOT NULL,
 source text NOT NULL DEFAULT 'USER_ENTERED',source_reference text,
 verification_state text NOT NULL DEFAULT 'USER_ASSERTED' CHECK(verification_state IN ('USER_ASSERTED','VERIFIED','ISSUER_VERIFIED','EXPIRED','REVOKED')),
 verification_method text,verified_at timestamptz,last_checked_at timestamptz,source_updated_at timestamptz,
 expires_at timestamptz,revoked_at timestamptz,selected boolean NOT NULL DEFAULT true,
 actor_id text REFERENCES accounts(id),metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(persona_id,identity_id) REFERENCES personas(id,identity_id)
);
CREATE UNIQUE INDEX selected_claim ON claims(identity_id,key,COALESCE(persona_id,''),locale) WHERE selected AND revoked_at IS NULL;
CREATE INDEX claims_identity ON claims(identity_id,persona_id);
CREATE INDEX claims_public_search ON claims(identity_id,key) WHERE selected AND policy->>'visibility'='PUBLIC' AND policy->>'searchable'='true';
CREATE TABLE relationships (
 id text PRIMARY KEY,source_id text NOT NULL REFERENCES identities(id),target_id text NOT NULL REFERENCES identities(id),
 type text NOT NULL,policy jsonb NOT NULL,source text NOT NULL DEFAULT 'USER_ENTERED',
 verification_state text NOT NULL DEFAULT 'UNILATERAL',confirmed_at timestamptz,expires_at timestamptz,revoked_at timestamptz,
 actor_id text NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_id<>target_id),UNIQUE(source_id,target_id,type)
);
CREATE TABLE applications (
 id text PRIMARY KEY,account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name text NOT NULL,purpose text NOT NULL,redirect_uris jsonb NOT NULL DEFAULT '[]',
 key_digest text UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz
);
CREATE TABLE consents (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),application_id text NOT NULL REFERENCES applications(id),
 persona_id text,scopes jsonb NOT NULL,fields jsonb NOT NULL,token_digest text NOT NULL UNIQUE,
 granted_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,last_access_at timestamptz,revoked_at timestamptz,
 FOREIGN KEY(persona_id,identity_id) REFERENCES personas(id,identity_id)
);
CREATE INDEX consents_identity ON consents(identity_id);
CREATE TABLE media (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),
 persona_id text,source_key text NOT NULL UNIQUE,mime text,status text NOT NULL DEFAULT 'PENDING',
 bytes integer,width integer,height integer,alt text NOT NULL,
 variants jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(persona_id,identity_id) REFERENCES personas(id,identity_id),
 CHECK(status IN ('PENDING','PROCESSING','READY','REJECTED','DELETED'))
);
ALTER TABLE identities ADD CONSTRAINT identity_avatar_fk FOREIGN KEY(avatar_media_id) REFERENCES media(id);
ALTER TABLE personas ADD CONSTRAINT persona_avatar_fk FOREIGN KEY(avatar_media_id) REFERENCES media(id);
CREATE TABLE domains (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),
 domain text NOT NULL UNIQUE,challenge_digest text NOT NULL,challenge_value text NOT NULL,
 method text NOT NULL DEFAULT 'DNS',verified_at timestamptz,last_checked_at timestamptz,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitations (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),email text NOT NULL,
 role text NOT NULL,digest text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,accepted_at timestamptz,
 actor_id text NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhooks (
 id text PRIMARY KEY,application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
 url text NOT NULL,events jsonb NOT NULL,secret_encrypted text NOT NULL,enabled boolean NOT NULL DEFAULT true,
 failures integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit (
 id text PRIMARY KEY,actor_id text,identity_id text,action text NOT NULL,
 request_id text NOT NULL,data jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_identity ON audit(identity_id,created_at DESC);
CREATE TABLE revisions (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),actor_id text NOT NULL,
 revision integer NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(identity_id,revision)
);
CREATE TABLE jobs (
 id text PRIMARY KEY,kind text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0,run_after timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,lease_token text,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE INDEX runnable_jobs ON jobs(run_after,created_at) WHERE status IN ('PENDING','RUNNING');
CREATE TABLE exports (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),account_id text NOT NULL REFERENCES accounts(id),
 status text NOT NULL DEFAULT 'PENDING',object_key text,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reports (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),reporter_id text REFERENCES accounts(id),
 category text NOT NULL,description text NOT NULL,state text NOT NULL DEFAULT 'OPEN',
 disposition text,moderator_id text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE analytics_daily (
 identity_id text NOT NULL REFERENCES identities(id),day date NOT NULL,kind text NOT NULL,count bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(identity_id,day,kind)
);
CREATE TABLE qr_codes (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),persona_id text,expires_at timestamptz,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(persona_id,identity_id) REFERENCES personas(id,identity_id)
);
