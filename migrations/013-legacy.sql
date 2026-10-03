ALTER TABLE identities DROP CONSTRAINT identities_state_check;
ALTER TABLE identities ADD CONSTRAINT identities_state_check CHECK(state IN ('ACTIVE','RESTRICTED','LOCKED','SUSPENDED','MERGED','MEMORIALIZED','FROZEN','ARCHIVED','DELETED'));
CREATE TABLE legacy_policies (
 identity_id text PRIMARY KEY REFERENCES identities(id),owner_id text NOT NULL REFERENCES accounts(id),custodian_id text NOT NULL REFERENCES accounts(id),
 outcome text NOT NULL CHECK(outcome IN ('MEMORIALIZE','FREEZE','TRANSFER_TO_CUSTODIAN','ARCHIVE','DELETE')),
 version integer NOT NULL DEFAULT 1,accepted_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CHECK(owner_id<>custodian_id)
);
CREATE TABLE legacy_requests (
 id text PRIMARY KEY,identity_id text NOT NULL REFERENCES identities(id),policy_version integer NOT NULL,
 requester_id text NOT NULL REFERENCES accounts(id),evidence_encrypted text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','VETOED','APPLIED')),
 not_before timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz
);
CREATE UNIQUE INDEX pending_legacy_request ON legacy_requests(identity_id) WHERE state IN ('PENDING','APPROVED');
CREATE TABLE legacy_reviews (
 request_id text NOT NULL REFERENCES legacy_requests(id),reviewer_id text NOT NULL REFERENCES accounts(id),
 decision text NOT NULL CHECK(decision IN ('APPROVE','REJECT')),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(request_id,reviewer_id)
);
