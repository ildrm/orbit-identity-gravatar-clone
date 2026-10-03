import { Input } from '../input.js';
import { Controller, Get, Post, Delete, Body, Param, Req, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityService } from '../identity/identity.service.js';
import { requireAccount, type ApiRequest } from '../http.js';
import { query, transaction } from '../../../../packages/core/src/db.js';
import { id, secret, digest } from '../../../../packages/core/src/security.js';
import { event, enqueue } from '../../../../packages/core/src/events.js';
import { DomainError, requireValue } from '../../../../packages/core/src/errors.js';
import {
  emailSchema,
  roleTypes,
  relationshipSchema,
} from '../../../../packages/contracts/src/index.js';
const OrganizationsControllerinviteInput = z
  .object({
    email: emailSchema,
    role: z
      .enum(roleTypes)
      .refine((role) => role !== 'OWNER', 'Ownership transfer requires a separate proof workflow'),
  })
  .strict();
const OrganizationsControlleracceptInput = z.object({ token: z.string().max(200) }).strict();
const OrganizationsControllerrelationshipInput = relationshipSchema;
@ApiTags('Organizations and relationships')
@Controller('api/v1')
export class OrganizationsController {
  constructor(@Inject(IdentityService) private readonly identities: IdentityService) {}
  @Get('identities/:id/members') async members(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'members');
    return query(
      'SELECT m.account_id,m.role,m.created_at,a.email FROM memberships m JOIN accounts a ON a.id=m.account_id WHERE m.identity_id=$1 ORDER BY m.created_at',
      [identityId],
    );
  }
  @Input(OrganizationsControllerinviteInput)
  @Post('identities/:id/invitations')
  async invite(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = OrganizationsControllerinviteInput.parse(b),
      token = secret();
    await transaction(async (db) => {
      const i = await this.identities.authorize(a.id, identityId, 'members', db);
      if (d.role === 'ADMIN' && i.role !== 'OWNER')
        throw new DomainError('FORBIDDEN', 'Only owners can grant administration.', 403);
      await query(
        "INSERT INTO invitations(id,identity_id,email,role,digest,expires_at,actor_id) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6)",
        [id('inv'), identityId, d.email, d.role, digest(token), a.id],
        db,
      );
      await enqueue(db, 'email', { to: d.email, template: 'invitation', token, identityId });
      await event(db, identityId, a.id, 'membership.invited', r.requestId, { role: d.role });
    });
    return { message: 'Invitation sent' };
  }
  @Input(OrganizationsControlleracceptInput)
  @Post('invitations/accept')
  async accept(@Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      { token } = OrganizationsControlleracceptInput.parse(b);
    return transaction(async (db) => {
      const invitation = requireValue(
        (
          await query<{ identity_id: string; role: string }>(
            'UPDATE invitations SET accepted_at=now() WHERE digest=$1 AND email=$2 AND accepted_at IS NULL AND expires_at>now() RETURNING identity_id,role',
            [digest(token), a.email],
            db,
          )
        )[0],
        'Invitation expired or is addressed to another account.',
      );
      await query(
        'INSERT INTO memberships(identity_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [invitation.identity_id, a.id, invitation.role],
        db,
      );
      await event(db, invitation.identity_id, a.id, 'membership.accepted', r.requestId);
      return { identityId: invitation.identity_id };
    });
  }
  @Delete('identities/:id/members/:account') async remove(
    @Param('id') identityId: string,
    @Param('account') accountId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      const i = await this.identities.authorize(a.id, identityId, 'members', db);
      const target = requireValue(
        (
          await query<{ role: string }>(
            'SELECT role FROM memberships WHERE identity_id=$1 AND account_id=$2',
            [identityId, accountId],
            db,
          )
        )[0],
      );
      if (target.role === 'OWNER' || (target.role === 'ADMIN' && i.role !== 'OWNER'))
        throw new DomainError(
          'FORBIDDEN',
          'Only owners may remove admins; ownership must be transferred separately.',
          403,
        );
      await query(
        'DELETE FROM memberships WHERE identity_id=$1 AND account_id=$2',
        [identityId, accountId],
        db,
      );
      await event(db, identityId, a.id, 'membership.removed', r.requestId);
    });
    return { message: 'Access removed' };
  }
  @Get('identities/:id/relationships') async relationships(
    @Param('id') identityId: string,
    @Req() r: ApiRequest,
  ) {
    await this.identities.authorize(requireAccount(r).id, identityId, 'read');
    return query(
      'SELECT r.*,s.handle AS source_handle,t.handle AS target_handle FROM relationships r JOIN identities s ON s.id=r.source_id JOIN identities t ON t.id=r.target_id WHERE (r.source_id=$1 OR r.target_id=$1) AND r.revoked_at IS NULL ORDER BY r.created_at DESC LIMIT 100',
      [identityId],
    );
  }
  @Input(OrganizationsControllerrelationshipInput)
  @Post('identities/:id/relationships')
  async relationship(@Param('id') identityId: string, @Body() b: unknown, @Req() r: ApiRequest) {
    const a = requireAccount(r),
      d = OrganizationsControllerrelationshipInput.parse(b),
      relationshipId = id('rel');
    await transaction(async (db) => {
      await this.identities.authorize(a.id, identityId, 'claims', db);
      requireValue(
        (
          await query(
            "SELECT 1 FROM identities WHERE id=$1 AND state='ACTIVE' AND visibility<>'PRIVATE'",
            [d.targetId],
            db,
          )
        )[0],
        'Target unavailable',
      );
      if (identityId === d.targetId)
        throw new DomainError('INVALID_RELATIONSHIP', 'An identity cannot relate to itself.');
      await query(
        'INSERT INTO relationships(id,source_id,target_id,type,policy,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
        [relationshipId, identityId, d.targetId, d.type, JSON.stringify(d.policy), a.id],
        db,
      );
      await event(db, identityId, a.id, 'relationship.created', r.requestId, { relationshipId });
    });
    return { id: relationshipId, ...d, verification: 'UNILATERAL' };
  }
  @Delete('relationships/:id') async revokeRelationship(
    @Param('id') relationshipId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      const relationship = requireValue(
        (
          await query<{ source_id: string; target_id: string }>(
            'SELECT source_id,target_id FROM relationships WHERE id=$1 AND revoked_at IS NULL',
            [relationshipId],
            db,
          )
        )[0],
      );
      const [membership] = await query<{ identity_id: string; role: string }>(
        "SELECT m.identity_id,m.role FROM memberships m JOIN identities i ON i.id=m.identity_id WHERE m.account_id=$1 AND m.identity_id=ANY($2::text[]) AND m.role IN ('OWNER','ADMIN') AND i.state='ACTIVE' ORDER BY m.identity_id LIMIT 1",
        [a.id, [relationship.source_id, relationship.target_id]],
        db,
      );
      if (!membership)
        throw new DomainError(
          'FORBIDDEN',
          'Only administrators of either endpoint can revoke this relationship.',
          403,
        );
      await this.identities.authorize(a.id, membership.identity_id, 'organization', db);
      await query(
        "UPDATE relationships SET revoked_at=now(),verification_state='REVOKED' WHERE id=$1",
        [relationshipId],
        db,
      );
      await event(db, relationship.source_id, a.id, 'relationship.revoked', r.requestId, {
        relationshipId,
      });
    });
    return { message: 'Relationship revoked' };
  }
  @Post('relationships/:id/confirm') async confirm(
    @Param('id') relationshipId: string,
    @Req() r: ApiRequest,
  ) {
    const a = requireAccount(r);
    await transaction(async (db) => {
      const rel = requireValue(
        (
          await query<{ target_id: string; source_id: string }>(
            'SELECT target_id,source_id FROM relationships WHERE id=$1 AND revoked_at IS NULL',
            [relationshipId],
            db,
          )
        )[0],
      );
      await this.identities.authorize(a.id, rel.target_id, 'organization', db);
      await query(
        "UPDATE relationships SET verification_state='MUTUALLY_CONFIRMED',confirmed_at=now() WHERE id=$1",
        [relationshipId],
        db,
      );
      await event(db, rel.source_id, a.id, 'relationship.updated', r.requestId, { relationshipId });
    });
    return { message: 'Relationship confirmed' };
  }
}
