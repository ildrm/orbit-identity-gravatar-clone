import { Input } from '../input.js';
import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id } from '../../../../packages/core/src/security.js';
import { event } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import {
  claimValues,
  policySchema,
  privatePolicy,
} from '../../../../packages/contracts/src/index.js';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
const keys = [
  'professional:employer',
  'professional:job_title',
  'org:department',
  'org:employment',
  'org:membership',
  'org:certification',
  'org:education',
  'org:project_role',
] as const;
const assertionSchema = z
  .object({
    subjectId: z.string().regex(/^idn_[a-f0-9]{32}$/),
    key: z.enum(keys),
    value: z.unknown(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
      .default('en'),
    expiresAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!claimValues[v.key].safeParse(v.value).success)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid assertion value.' });
  });
interface Assertion {
  id: string;
  issuer_id: string;
  subject_id: string;
  key: string;
  value: unknown;
  locale: string;
  state: string;
  expires_at: Date;
  revoked_at: Date | null;
  issuer_state: string;
}
const EnterpriseControllerissueInput = assertionSchema;
const EnterpriseControlleracceptInput = z
  .object({ policy: policySchema.default(privatePolicy) })
  .strict();
const EnterpriseControllerdisputeInput = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
@ApiTags('Organization assertions')
@Controller('api/v1')
export class EnterpriseController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('identities/:id/assertions') async incoming(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return query(
      'SELECT a.*,i.handle AS issuer_handle,i.state AS issuer_state FROM enterprise_assertions a JOIN identities i ON i.id=a.issuer_id WHERE a.subject_id=$1 ORDER BY a.created_at DESC LIMIT 500',
      [identityId],
    );
  }
  @Get('organizations/:id/assertions') async outgoing(
    @Param('id') issuerId: string,
    @Req() r: ApiRequest,
  ) {
    const issuer = await this.identities.authorize(requireAccount(r).id, issuerId, 'organization');
    this.requireIssuer(issuer);
    return query(
      'SELECT * FROM enterprise_assertions WHERE issuer_id=$1 ORDER BY created_at DESC LIMIT 500',
      [issuerId],
    );
  }
  private requireIssuer(issuer: { type: string; state: string }) {
    if (!['ORGANIZATION', 'TEAM', 'COMMUNITY'].includes(issuer.type) || issuer.state !== 'ACTIVE')
      throw new DomainError(
        'INVALID_ISSUER',
        'An active organization, team or community is required.',
        403,
      );
  }
  @Input(EnterpriseControllerissueInput)
  @Post('organizations/:id/assertions')
  async issue(@Param('id') issuerId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const d = EnterpriseControllerissueInput.parse(b),
      accountId = requireAccount(r).id,
      assertionId = id('ast');
    if (
      new Date(d.expiresAt).getTime() <= Date.now() ||
      new Date(d.expiresAt).getTime() > Date.now() + 3 * 365 * 86400000
    )
      throw new DomainError(
        'INVALID_EXPIRY',
        'Organization assertions must expire within three years.',
      );
    await transaction(async (db) => {
      await query(
        'SELECT id FROM identities WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [[issuerId, d.subjectId]],
        db,
      );
      const issuer = await this.identities.authorize(accountId, issuerId, 'organization', db);
      this.requireIssuer(issuer);
      const subject = requireValue(
        (
          await query<{ state: string }>(
            'SELECT state FROM identities WHERE id=$1',
            [d.subjectId],
            db,
          )
        )[0],
        'Recipient unavailable',
      );
      if (subject.state !== 'ACTIVE' || issuerId === d.subjectId)
        throw new DomainError('INVALID_SUBJECT', 'Choose a different active identity.');
      await query(
        'INSERT INTO enterprise_assertions(id,issuer_id,subject_id,key,value,locale,actor_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          assertionId,
          issuerId,
          d.subjectId,
          d.key,
          JSON.stringify(d.value),
          d.locale,
          accountId,
          d.expiresAt,
        ],
        db,
      );
      await event(db, issuerId, accountId, 'assertion.issued', r.requestId, {
        assertionId,
        subjectId: d.subjectId,
      });
      await event(db, d.subjectId, accountId, 'assertion.received', r.requestId, {
        assertionId,
        issuerId,
      });
    });
    return { id: assertionId, state: 'PENDING' };
  }
  @Input(EnterpriseControlleracceptInput)
  @Post('identities/:id/assertions/:assertion/accept')
  async accept(
    @Param('id') subjectId: string,
    @Param('assertion') assertionId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const d = EnterpriseControlleracceptInput.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, subjectId, 'security', db);
      const a = requireValue(
        (
          await query<Assertion>(
            'SELECT a.*,i.state AS issuer_state FROM enterprise_assertions a JOIN identities i ON i.id=a.issuer_id WHERE a.id=$1 AND a.subject_id=$2 FOR UPDATE OF a',
            [assertionId, subjectId],
            db,
          )
        )[0],
        'Assertion unavailable',
      );
      if (
        !['PENDING', 'ACCEPTED'].includes(a.state) ||
        a.issuer_state !== 'ACTIVE' ||
        a.revoked_at ||
        new Date(a.expires_at).getTime() <= Date.now()
      )
        throw new DomainError(
          'ASSERTION_UNAVAILABLE',
          'The issuer assertion has expired, was revoked or is disputed.',
          409,
        );
      await this.identities.snapshot(db, subjectId, accountId);
      await query(
        'UPDATE claims SET selected=false WHERE identity_id=$1 AND key=$2 AND persona_id IS NULL AND locale=$3 AND selected',
        [subjectId, a.key, a.locale],
        db,
      );
      await query(
        "INSERT INTO claims(id,identity_id,key,value,locale,policy,source,source_reference,verification_state,verification_method,verified_at,expires_at,actor_id,assertion_id) VALUES($1,$2,$3,$4,$5,$6,'ORGANIZATION_ISSUED',$7,'ISSUER_VERIFIED','ORGANIZATION_ASSERTION',now(),$8,$9,$10) ON CONFLICT(assertion_id) WHERE assertion_id IS NOT NULL DO UPDATE SET policy=EXCLUDED.policy,selected=true,updated_at=now()",
        [
          id('clm'),
          subjectId,
          a.key,
          JSON.stringify(a.value),
          a.locale,
          JSON.stringify(d.policy),
          a.issuer_id,
          a.expires_at,
          accountId,
          a.id,
        ],
        db,
      );
      await query(
        "UPDATE enterprise_assertions SET state='ACCEPTED',accepted_by=$1,accepted_at=COALESCE(accepted_at,now()),updated_at=now() WHERE id=$2",
        [accountId, assertionId],
        db,
      );
      await event(db, subjectId, accountId, 'claim.updated', r.requestId, {
        assertionId,
        issuerId: a.issuer_id,
        key: a.key,
      });
    });
    return { message: 'Assertion accepted with your selected privacy policy.' };
  }
  @Input(EnterpriseControllerdisputeInput)
  @Post('identities/:id/assertions/:assertion/dispute')
  async dispute(
    @Param('id') subjectId: string,
    @Param('assertion') assertionId: string,
    @Body() b: unknown,
    @Req() r: ApiRequest,
  ) {
    const d = EnterpriseControllerdisputeInput.parse(b),
      accountId = requireAccount(r).id;
    await transaction(async (db) => {
      await this.identities.authorize(accountId, subjectId, 'security', db);
      const rows = await query(
        "UPDATE enterprise_assertions SET state='DISPUTED',dispute_reason=$1,updated_at=now() WHERE id=$2 AND subject_id=$3 AND state IN ('PENDING','ACCEPTED') RETURNING id",
        [d.reason, assertionId, subjectId],
        db,
      );
      requireValue(rows[0], 'Assertion unavailable');
      await query('UPDATE claims SET selected=false WHERE assertion_id=$1', [assertionId], db);
      await event(db, subjectId, accountId, 'assertion.disputed', r.requestId, { assertionId });
    });
    return { message: 'Assertion disputed and removed from publication.' };
  }
  @Post('organizations/:id/assertions/:assertion/revoke') async revoke(
    @Param('id') issuerId: string,
    @Param('assertion') assertionId: string,
    @Req() r: ApiRequest,
  ) {
    const accountId = requireAccount(r).id;
    await transaction(async (db) => {
      const issuer = await this.identities.authorize(accountId, issuerId, 'organization', db);
      this.requireIssuer(issuer);
      const a = requireValue(
        (
          await query<{ subject_id: string }>(
            "UPDATE enterprise_assertions SET state='REVOKED',revoked_at=now(),updated_at=now() WHERE id=$1 AND issuer_id=$2 RETURNING subject_id",
            [assertionId, issuerId],
            db,
          )
        )[0],
        'Assertion unavailable',
      );
      await query(
        "UPDATE claims SET revoked_at=now(),verification_state='REVOKED',selected=false WHERE assertion_id=$1",
        [assertionId],
        db,
      );
      await event(db, issuerId, accountId, 'assertion.revoked', r.requestId, { assertionId });
      await event(db, a.subject_id, accountId, 'claim.revoked', r.requestId, { assertionId });
    });
    return { message: 'Issuer assertion revoked. The recipient identity remains active.' };
  }
}
