ALTER TABLE identities ADD COLUMN federation_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE federation_peers (
 id text PRIMARY KEY,origin text NOT NULL UNIQUE,did text NOT NULL,document jsonb NOT NULL,fingerprint text NOT NULL,
 approved_by text NOT NULL REFERENCES accounts(id),approved_at timestamptz NOT NULL DEFAULT now(),blocked_at timestamptz
);
CREATE TABLE federation_outbox (
 sequence bigserial PRIMARY KEY,id text NOT NULL UNIQUE,identity_id text NOT NULL REFERENCES identities(id),event_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE federation_receipts (
 peer_id text NOT NULL REFERENCES federation_peers(id),message_id text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(peer_id,message_id)
);
CREATE TABLE remote_profiles (
 actor text PRIMARY KEY,peer_id text NOT NULL REFERENCES federation_peers(id),sequence bigint NOT NULL,
 profile jsonb,state text NOT NULL CHECK(state IN ('ACTIVE','DELETED','MOVED')),moved_to text,
 expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX remote_profiles_peer ON remote_profiles(peer_id,state);
CREATE UNIQUE INDEX federation_delivery_job ON jobs((payload->>'deliveryId')) WHERE kind='federation';
