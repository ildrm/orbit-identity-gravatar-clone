import { query } from './db.js';
import { id } from './security.js';
import { randomUUID } from 'node:crypto';
export async function applicationAccess(
  consentId: string,
  operation: 'profile' | 'credentials' | 'avatar',
  requestId: string = randomUUID(),
) {
  await query(
    'INSERT INTO application_access_logs(id,application_id,consent_id,operation,request_id) SELECT $1,application_id,id,$2,$3 FROM consents WHERE id=$4 AND revoked_at IS NULL AND expires_at>now()',
    [id('log'), operation, requestId, consentId],
  );
}
