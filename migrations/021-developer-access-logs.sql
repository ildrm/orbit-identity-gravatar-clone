CREATE TABLE application_access_logs (id text PRIMARY KEY,application_id text NOT NULL REFERENCES applications(id),consent_id text REFERENCES consents(id),operation text NOT NULL CHECK(operation IN ('profile','credentials')),request_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX application_logs_recent ON application_access_logs(application_id,created_at DESC);
