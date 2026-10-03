import { Input } from '../input.js';
import { Body, Controller, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { config } from '../../../../packages/core/src/config.js';
import { id, encrypt, decrypt } from '../../../../packages/core/src/security.js';
import { event, enqueue, audit } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import { purgeIdentity } from '../../../../packages/core/src/lifecycle.js';
import { IdentityService } from '../identity/identity.service.js';
import { AuthService } from '../auth/auth.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
interface Policy {
  identity_id: string;
  owner_id: string;
  custodian_id: string;
  outcome: string;
  version: number;
  accepted_at: Date | null;
  revoked_at: Date | null;
}
function moderator(r: ApiRequest) {
  const account = requireAccount(r);
  if (
    !config()
      .MODERATOR_EMAILS.split(',')
      .map((v) => v.trim().toLowerCase())
      .includes(account.email)
  )
    throw new DomainError('FORBIDDEN', 'Legacy reviewer access required.', 403);
  return account;
}
const LegacyControllerconfigureInput = z
  .object({
    custodianEmail: z.email().max(254),
    outcome: z.enum(['MEMORIALIZE', 'FREEZE', 'TRANSFER_TO_CUSTODIAN', 'ARCHIVE', 'DELETE']),
    proof: z.string().max(200),
  })
  .strict();
const LegacyControllerrequestInput = z
  .object({ evidence: z.string().trim().min(100).max(10000), proof: z.string().max(200) })
  .strict();
const LegacyControllervetoInput = z.object({ proof: z.string().max(200) }).strict();
const LegacyControllerreviewInput = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().min(50).max(3000),
    proof: z.string().max(200),
  })
  .strict();
const LegacyControllerapplyInput = z.object({ proof: z.string().max(200) }).strict();
@ApiTags('Optional digital legacy')
@Controller('api/v1')
export class LegacyController {
  constructor(
    @Inject(IdentityService) private readonly identities: IdentityService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get('identities/:id/legacy') async policy(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'security');
    return {
      policy:
        (
          await query(
            'SELECT identity_id,custodian_id,outcome,version,accepted_at,revoked_at FROM legacy_policies WHERE identity_id=$1',
            [identityId],
          )
        )[0] ?? null,
      requests: await query(
        'SELECT id,state,not_before,created_at,applied_at FROM legacy_requests WHERE identity_id=$1 ORDER BY created_at DESC LIMIT 50',
        [identityId],
      ),
    };
  }
  @Input(LegacyControllerconfigureInput)
  @Put('identities/:id/legacy')
  async configure(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = LegacyControllerconfigureInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const identity = await this.identities.authorize(accountId, identityId, 'security', db);
      if (identity.state !== 'ACTIVE')
        throw new DomainError(
          'LEGACY_UNAVAILABLE',
          'Configure legacy while the identity is active.',
        );
      const custodian = requireValue(
        (
          await query<{ id: string }>(
            "SELECT id FROM accounts WHERE email=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
            [d.custodianEmail.toLowerCase()],
            db,
          )
        )[0],
        'Custodian must have a verified active account',
      );
      if (custodian.id === accountId)
        throw new DomainError('INVALID_CUSTODIAN', 'Choose a different verified account.');
      await query(
        'INSERT INTO legacy_policies(identity_id,owner_id,custodian_id,outcome) VALUES($1,$2,$3,$4) ON CONFLICT(identity_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,custodian_id=EXCLUDED.custodian_id,outcome=EXCLUDED.outcome,version=legacy_policies.version+1,accepted_at=NULL,revoked_at=NULL',
        [identityId, accountId, custodian.id, d.outcome],
        db,
      );
      await query(
        "UPDATE legacy_requests SET state='VETOED' WHERE identity_id=$1 AND state IN ('PENDING','APPROVED')",
        [identityId],
        db,
      );
      await event(db, identityId, accountId, 'legacy.configured', r.requestId, {
        outcome: d.outcome,
      });
    });
    return {
      message: 'Legacy policy saved. The custodian must accept it; no inactivity trigger exists.',
    };
  }
  @Get('legacy/custodianships') custodianships(@Req() r: ApiRequest) {
    return query(
      'SELECT p.identity_id,p.outcome,p.version,p.accepted_at,p.revoked_at FROM legacy_policies p WHERE p.custodian_id=$1 AND p.revoked_at IS NULL',
      [requireAccount(r).id],
    );
  }
  @Post('legacy/:id/accept') async accept(@Param('id') identityId: string, @Req() r: ApiRequest) {
    const accountId = requireAccount(r).id;
    await transaction(async (db) => {
      requireValue(
        (
          await query(
            'UPDATE legacy_policies SET accepted_at=now() WHERE identity_id=$1 AND custodian_id=$2 AND revoked_at IS NULL RETURNING identity_id',
            [identityId, accountId],
            db,
          )
        )[0],
        'Custodianship unavailable',
      );
      await event(db, identityId, accountId, 'legacy.accepted', r.requestId);
    });
    return { message: 'Custodianship accepted. This grants no current profile management access.' };
  }
  @Input(LegacyControllerrequestInput)
  @Post('legacy/:id/request')
  async request(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = LegacyControllerrequestInput.parse(b),
      accountId = requireAccount(r).id,
      requestId = id('leg');
    await this.auth.requireStepUp(accountId, d.proof);
    await transaction(async (db) => {
      const policy = requireValue(
        (
          await query<Policy>(
            'SELECT * FROM legacy_policies WHERE identity_id=$1 AND custodian_id=$2 AND accepted_at IS NOT NULL AND revoked_at IS NULL FOR UPDATE',
            [identityId, accountId],
            db,
          )
        )[0],
        'Accepted custodianship unavailable',
      );
      requireValue(
        (
          await query(
            "SELECT 1 FROM memberships m JOIN identities i ON i.id=m.identity_id WHERE m.identity_id=$1 AND m.account_id=$2 AND m.role='OWNER' AND i.state='ACTIVE'",
            [identityId, policy.owner_id],
            db,
          )
        )[0],
        'Policy owner changed',
      );
      await query(
        "INSERT INTO legacy_requests(id,identity_id,policy_version,requester_id,evidence_encrypted,not_before) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')",
        [requestId, identityId, policy.version, accountId, encrypt(d.evidence)],
        db,
      );
      const owner = requireValue(
        (
          await query<{ email: string }>(
            "SELECT email FROM accounts WHERE id=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
            [policy.owner_id],
            db,
          )
        )[0],
        'Owner account unavailable',
      );
      await enqueue(db, 'email', {
        to: owner.email,
        template: 'legacy-request',
        accountId: policy.owner_id,
        legacyRequestId: requestId,
      });
      await event(db, identityId, accountId, 'legacy.requested', r.requestId, {
        legacyRequestId: requestId,
        outcome: policy.outcome,
      });
    });
    return {
      id: requestId,
      message:
        'Owner notified. Action requires a 30-day waiting period and two independent reviewer approvals.',
    };
  }
  @Input(LegacyControllervetoInput)
  @Post('identities/:id/legacy/veto')
  async veto(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const { proof } = LegacyControllervetoInput.parse(b),
      accountId = requireAccount(r).id;
    await this.auth.requireStepUp(accountId, proof);
    await transaction(async (db) => {
      await this.identities.authorize(accountId, identityId, 'security', db);
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE identity_id=$1',
        [identityId],
        db,
      );
      await query(
        "UPDATE legacy_requests SET state='VETOED',evidence_encrypted='' WHERE identity_id=$1 AND state IN ('PENDING','APPROVED')",
        [identityId],
        db,
      );
      await event(db, identityId, accountId, 'legacy.vetoed', r.requestId);
    });
    return { message: 'Legacy policy revoked and pending requests vetoed.' };
  }
  @Get('admin/legacy') async reviewQueue(@Req() r: ApiRequest) {
    moderator(r);
    return query(
      "SELECT q.id,q.identity_id,q.state,q.not_before,q.created_at,p.outcome FROM legacy_requests q JOIN legacy_policies p ON p.identity_id=q.identity_id WHERE q.state IN ('PENDING','APPROVED') ORDER BY q.created_at LIMIT 100",
    );
  }
  @Get('admin/legacy/:id') async evidence(@Param('id') requestId: string, @Req() r: ApiRequest) {
    const account = moderator(r),
      q = requireValue(
        (
          await query<{ evidence_encrypted: string; requester_id: string; owner_id: string }>(
            'SELECT q.evidence_encrypted,q.requester_id,p.owner_id FROM legacy_requests q JOIN legacy_policies p ON p.identity_id=q.identity_id WHERE q.id=$1',
            [requestId],
          )
        )[0],
        'Request unavailable',
      );
    if ([q.requester_id, q.owner_id].includes(account.id))
      throw new DomainError(
        'REVIEW_CONFLICT',
        'Beneficiaries and owners cannot review their own legacy requests.',
        403,
      );
    return {
      evidence: q.evidence_encrypted ? decrypt(q.evidence_encrypted) : '',
      reviews: await query(
        'SELECT reviewer_id,decision,reason,created_at FROM legacy_reviews WHERE request_id=$1',
        [requestId],
      ),
    };
  }
  @Input(LegacyControllerreviewInput)
  @Post('admin/legacy/:id/review')
  async review(@Param('id') requestId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const account = moderator(r),
      d = LegacyControllerreviewInput.parse(b);
    await this.auth.requireStepUp(account.id, d.proof);
    await transaction(async (db) => {
      const q = requireValue(
        (
          await query<{
            identity_id: string;
            requester_id: string;
            owner_id: string;
            custodian_id: string;
            policy_version: number;
            version: number;
          }>(
            "SELECT q.*,p.owner_id,p.custodian_id,p.version FROM legacy_requests q JOIN legacy_policies p ON p.identity_id=q.identity_id WHERE q.id=$1 AND q.state IN ('PENDING','APPROVED') AND p.revoked_at IS NULL FOR UPDATE OF q,p",
            [requestId],
            db,
          )
        )[0],
        'Request unavailable',
      );
      if (
        q.policy_version !== q.version ||
        [q.requester_id, q.owner_id, q.custodian_id].includes(account.id)
      )
        throw new DomainError(
          'REVIEW_CONFLICT',
          'Reviewers must be independent and review the current policy.',
          403,
        );
      await query(
        'INSERT INTO legacy_reviews(request_id,reviewer_id,decision,reason) VALUES($1,$2,$3,$4)',
        [requestId, account.id, d.decision, d.reason],
        db,
      );
      if (d.decision === 'REJECT')
        await query("UPDATE legacy_requests SET state='REJECTED' WHERE id=$1", [requestId], db);
      else if (
        (
          await query(
            "SELECT 1 FROM legacy_reviews WHERE request_id=$1 AND decision='APPROVE'",
            [requestId],
            db,
          )
        ).length >= 2
      )
        await query("UPDATE legacy_requests SET state='APPROVED' WHERE id=$1", [requestId], db);
      await audit(db, account.id, q.identity_id, 'legacy.reviewed', r.requestId, {
        legacyRequestId: requestId,
        decision: d.decision,
      });
    });
    return { message: 'Independent review recorded.' };
  }
  @Input(LegacyControllerapplyInput)
  @Post('admin/legacy/:id/apply')
  async apply(@Param('id') requestId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const account = moderator(r),
      { proof } = LegacyControllerapplyInput.parse(b);
    await this.auth.requireStepUp(account.id, proof);
    await transaction(async (db) => {
      const candidate = requireValue(
        (
          await query<{ identity_id: string }>(
            'SELECT identity_id FROM legacy_requests WHERE id=$1',
            [requestId],
            db,
          )
        )[0],
        'Request unavailable',
      );
      const identity = requireValue(
        (
          await query<{ state: string }>(
            'SELECT state FROM identities WHERE id=$1 FOR UPDATE',
            [candidate.identity_id],
            db,
          )
        )[0],
        'Identity unavailable',
      );
      const q = requireValue(
        (
          await query<
            Policy & {
              policy_version: number;
              requester_id: string;
              not_before: Date;
              state: string;
            }
          >(
            'SELECT q.*,p.owner_id,p.custodian_id,p.outcome,p.version,p.accepted_at,p.revoked_at FROM legacy_requests q JOIN legacy_policies p ON p.identity_id=q.identity_id WHERE q.id=$1 FOR UPDATE OF q,p',
            [requestId],
            db,
          )
        )[0],
        'Request unavailable',
      );
      const reviews = await query<{ reviewer_id: string }>(
        "SELECT v.reviewer_id FROM legacy_reviews v JOIN accounts a ON a.id=v.reviewer_id WHERE v.request_id=$1 AND v.decision='APPROVE' AND a.state='ACTIVE' AND a.verified_at IS NOT NULL AND a.email=ANY($2::text[])",
        [
          requestId,
          config()
            .MODERATOR_EMAILS.split(',')
            .map((v) => v.trim().toLowerCase()),
        ],
        db,
      );
      if (
        identity.state !== 'ACTIVE' ||
        q.state !== 'APPROVED' ||
        q.revoked_at ||
        !q.accepted_at ||
        q.policy_version !== q.version ||
        new Date(q.not_before).getTime() > Date.now() ||
        reviews.length < 2 ||
        [q.owner_id, q.custodian_id].includes(account.id)
      )
        throw new DomainError(
          'LEGACY_SAFEGUARD',
          'The policy, waiting period and independent approvals must all remain valid.',
          409,
        );
      requireValue(
        (
          await query(
            "SELECT 1 FROM memberships WHERE identity_id=$1 AND account_id=$2 AND role='OWNER'",
            [q.identity_id, q.owner_id],
            db,
          )
        )[0],
        'Policy owner changed',
      );
      if (q.outcome === 'DELETE') await purgeIdentity(db, q.identity_id, account.id, r.requestId);
      else {
        await query(
          'UPDATE consents SET revoked_at=now() WHERE identity_id=$1',
          [q.identity_id],
          db,
        );
        await query(
          "UPDATE provider_connections SET revoked_at=now(),token_encrypted='' WHERE identity_id=$1",
          [q.identity_id],
          db,
        );
        if (q.outcome === 'TRANSFER_TO_CUSTODIAN') {
          requireValue(
            (
              await query(
                "SELECT 1 FROM accounts WHERE id=$1 AND state='ACTIVE' AND verified_at IS NOT NULL",
                [q.custodian_id],
                db,
              )
            )[0],
            'Custodian unavailable',
          );
          await query(
            "DELETE FROM memberships WHERE identity_id=$1 AND role='OWNER'",
            [q.identity_id],
            db,
          );
          await query(
            "INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,'OWNER') ON CONFLICT(identity_id,account_id) DO UPDATE SET role='OWNER'",
            [q.identity_id, q.custodian_id],
            db,
          );
        } else {
          const state = { MEMORIALIZE: 'MEMORIALIZED', FREEZE: 'FROZEN', ARCHIVE: 'ARCHIVED' }[
            q.outcome as 'MEMORIALIZE' | 'FREEZE' | 'ARCHIVE'
          ];
          await query(
            'UPDATE identities SET state=$2,contact_enabled=false,federation_enabled=false WHERE id=$1',
            [q.identity_id, state],
            db,
          );
          if (state === 'ARCHIVED')
            await query(
              "UPDATE identities SET visibility='PRIVATE',searchable=false,indexable=false,machine=false,agent=false WHERE id=$1",
              [q.identity_id],
              db,
            );
        }
      }
      await query(
        "UPDATE legacy_requests SET state='APPLIED',applied_at=now(),evidence_encrypted='' WHERE id=$1",
        [requestId],
        db,
      );
      await query(
        'UPDATE legacy_policies SET revoked_at=now() WHERE identity_id=$1',
        [q.identity_id],
        db,
      );
      await event(db, q.identity_id, account.id, 'legacy.applied', r.requestId, {
        legacyRequestId: requestId,
        outcome: q.outcome,
      });
    });
    return { message: 'The verified legacy policy was applied.' };
  }
}
