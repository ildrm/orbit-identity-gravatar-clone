UPDATE consents c SET account_id=(SELECT a.actor_id FROM audit a JOIN memberships m ON m.account_id=a.actor_id AND m.identity_id=c.identity_id AND m.role='OWNER' WHERE a.action='consent.updated' AND a.data->>'consentId'=c.id ORDER BY a.created_at LIMIT 1) WHERE c.account_id IS NULL;
UPDATE consents SET revoked_at=now() WHERE account_id IS NULL AND revoked_at IS NULL;
