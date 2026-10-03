import { Resolver } from 'node:dns/promises';
import { query, transaction } from './db.js';
import { safeHttps } from './outbound.js';
import { config } from './config.js';
import { digest } from './security.js';
import { event } from './events.js';
const resolver = new Resolver({ timeout: 3000, tries: 1 });
export interface DomainProof {
  id: string;
  identity_id: string;
  domain: string;
  method: string;
  challenge_digest: string;
  custom_enabled: boolean;
}
export async function checkDomainProof(d: DomainProof): Promise<boolean> {
  if (d.method === 'DNS') {
    const values = (await resolver.resolveTxt('_identity.' + d.domain)).map((v) => v.join(''));
    return values.some((v) => digest(v) === d.challenge_digest);
  }
  const response = await safeHttps('https://' + d.domain + '/.well-known/identity-verification', {
    maxBytes: 4096,
  });
  return response.status === 200 && digest(response.body.trim()) === d.challenge_digest;
}
export async function checkDomainRouting(domain: string): Promise<boolean> {
  const target = config().CUSTOM_DOMAIN_TARGET;
  if (!target) return false;
  const cname = await resolver.resolveCname(domain);
  return cname.some(
    (v) => v.toLowerCase().replace(/\.$/, '') === target.toLowerCase().replace(/\.$/, ''),
  );
}
export async function revalidateDomain(payload: Record<string, unknown>) {
  const [domain] = await query<DomainProof & { actor_id: string }>(
    "SELECT d.*,m.account_id AS actor_id FROM domains d JOIN memberships m ON m.identity_id=d.identity_id AND m.role='OWNER' WHERE d.id=$1 AND d.revoked_at IS NULL AND d.verified_at IS NOT NULL",
    [payload.domainId],
  );
  if (!domain) return;
  let valid = false,
    routing = false;
  try {
    valid = await checkDomainProof(domain);
    routing = !domain.custom_enabled || (await checkDomainRouting(domain.domain));
  } catch {
    valid = false;
  }
  await transaction(async (db) => {
    const current = (
      await query<DomainProof>(
        'SELECT * FROM domains WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',
        [domain.id],
        db,
      )
    )[0];
    if (!current || current.challenge_digest !== domain.challenge_digest) return;
    if (valid)
      await query(
        "UPDATE domains SET last_checked_at=now(),expires_at=now()+interval '30 days',routing_state=CASE WHEN custom_enabled THEN $2 ELSE 'DISABLED' END WHERE id=$1",
        [domain.id, routing ? 'ACTIVE' : 'DNS_ERROR'],
        db,
      );
    else {
      await query(
        "UPDATE domains SET last_checked_at=now(),routing_state='PROOF_ERROR',custom_enabled=false,canonical=false,revoked_at=now() WHERE id=$1",
        [domain.id],
        db,
      );
      await event(
        db,
        domain.identity_id,
        domain.actor_id,
        'domain.revoked',
        String(payload.requestId ?? 'scheduler'),
        { domainId: domain.id, reason: 'REVALIDATION' },
      );
    }
  });
}
